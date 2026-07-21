/**
 * Integration tests for loyal_core against a local validator.
 *
 * Run with the deterministic oracle compiled in:
 *   anchor build -- --features mock-oracle
 *   anchor test --skip-build
 *
 * Covers the priority list from the security requirements:
 *  - issue_points: happy path, replay rejection, expired QR, wrong signer,
 *    tampered payload, per-tx cap
 *  - positions: open -> win close, open -> loss close, 5x clamp, fee burn
 *  - liquidation: threshold enforcement + permissionless crank + bounty
 *  - pause switch
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import {
  ataFor,
  configPda,
  ed25519VerifyIx,
  listingPda,
  loyalMintPda,
  merchantPda,
  mockPricePda,
  noncePda,
  positionPda,
  qrMessage,
  userProfilePda,
  vaultPda,
  TOKEN_2022_PROGRAM_ID,
} from "./helpers";

describe("loyal_core", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.LoyalCore as Program;
  const hookProgram = anchor.workspace.LoyalHook as Program;
  const connection = provider.connection;
  const admin = provider.wallet as anchor.Wallet;

  const config = configPda(program.programId);
  const loyalMint = loyalMintPda(program.programId);

  const merchantAuthority = Keypair.generate();
  const qrSigner = Keypair.generate();
  const customer = Keypair.generate();
  const liquidator = Keypair.generate();
  const merchant = merchantPda(program.programId, merchantAuthority.publicKey);
  const customerProfile = userProfilePda(program.programId, customer.publicKey);
  const customerAta = ataFor(loyalMint, customer.publicKey);

  const VAULT_SYMBOL = "BONK";
  const vault = vaultPda(program.programId, VAULT_SYMBOL);
  const mockPrice = mockPricePda(program.programId, vault);
  // Any 32 bytes work under the mock oracle; the real feed id is only read
  // by the Pyth path.
  const feedId = Array.from(Buffer.alloc(32, 7));

  let nextNonce = 1n;

  const nowTs = async (): Promise<bigint> => {
    const slot = await connection.getSlot();
    return BigInt((await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000));
  };

  /** Builds [ed25519 verify, issue_points] for the given QR parameters. */
  const issueTx = async (opts: {
    points: bigint;
    nonce: bigint;
    expiry: bigint;
    signer?: Keypair;
    messageOverride?: Buffer;
  }): Promise<Transaction> => {
    const message =
      opts.messageOverride ??
      qrMessage(merchant, opts.points, opts.nonce, opts.expiry);
    const verifyIx = ed25519VerifyIx(opts.signer ?? qrSigner, message);
    const issueIx = await program.methods
      .issuePoints(
        new anchor.BN(opts.points.toString()),
        new anchor.BN(opts.nonce.toString()),
        new anchor.BN(opts.expiry.toString())
      )
      .accounts({
        user: customer.publicKey,
        config,
        merchant,
        userProfile: customerProfile,
        nonceAccount: noncePda(program.programId, merchant, opts.nonce),
        loyalMint,
        userAta: customerAta,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
    return new Transaction().add(verifyIx, issueIx);
  };

  const send = (tx: Transaction, signers: Keypair[]) =>
    provider.sendAndConfirm(tx, signers);

  const balance = async (): Promise<bigint> => {
    const info = await connection.getTokenAccountBalance(customerAta);
    return BigInt(info.value.amount);
  };

  const setMockPrice = async (price1e6: bigint) => {
    await program.methods
      .setMockPrice(new anchor.BN(price1e6.toString()))
      .accounts({ admin: admin.publicKey, config, vault, mockPrice })
      .rpc();
  };

  before(async () => {
    for (const kp of [merchantAuthority, customer, liquidator]) {
      const sig = await connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    await program.methods
      .initializeConfig(
        200, // fee_bps: 2%
        5, // max_leverage
        new anchor.BN(100_000), // max_position_stake
        new anchor.BN(10_000), // max_issue_per_tx
        new anchor.BN(10_000_000) // max_global_exposure
      )
      .accounts({
        admin: admin.publicKey,
        config,
        loyalMint,
        hookProgram: hookProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .registerMerchant("Kadıköy Coffee Lab", "cafe", qrSigner.publicKey, new anchor.BN(1_000_000))
      .accounts({
        authority: merchantAuthority.publicKey,
        config,
        merchant,
        systemProgram: SystemProgram.programId,
      })
      .signers([merchantAuthority])
      .rpc();

    await program.methods
      .createVault(VAULT_SYMBOL, feedId, new anchor.BN(50_000))
      .accounts({
        admin: admin.publicKey,
        config,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  describe("issue_points", () => {
    it("mints points for a valid merchant-signed QR", async () => {
      const expiry = (await nowTs()) + 60n;
      const nonce = nextNonce++;
      await send(await issueTx({ points: 200n, nonce, expiry }), [customer]);

      expect(await balance()).to.equal(200n);
      const profile: any = await (program.account as any).userProfile.fetch(customerProfile);
      expect(profile.earnedTotal.toNumber()).to.equal(200);
      expect(profile.streakDays).to.equal(1);
    });

    it("rejects a replayed QR (same nonce)", async () => {
      const expiry = (await nowTs()) + 60n;
      const nonce = nextNonce++;
      await send(await issueTx({ points: 100n, nonce, expiry }), [customer]);
      try {
        await send(await issueTx({ points: 100n, nonce, expiry }), [customer]);
        expect.fail("replay should have been rejected");
      } catch (err: any) {
        // The nonce marker PDA already exists -> `init` fails at the runtime level.
        expect(String(err)).to.match(/already in use|custom program error/i);
      }
    });

    it("rejects an expired QR", async () => {
      const expiry = (await nowTs()) - 5n;
      try {
        await send(await issueTx({ points: 100n, nonce: nextNonce++, expiry }), [customer]);
        expect.fail("expired QR should have been rejected");
      } catch (err: any) {
        expect(String(err)).to.include("QrExpired");
      }
    });

    it("rejects a QR signed by the wrong key", async () => {
      const expiry = (await nowTs()) + 60n;
      try {
        await send(
          await issueTx({ points: 100n, nonce: nextNonce++, expiry, signer: Keypair.generate() }),
          [customer]
        );
        expect.fail("wrong signer should have been rejected");
      } catch (err: any) {
        expect(String(err)).to.include("QrSignerMismatch");
      }
    });

    it("rejects a tampered payload (signed 10, claimed 10000)", async () => {
      const expiry = (await nowTs()) + 60n;
      const nonce = nextNonce++;
      // The signed message says 10 points, the instruction claims 10_000.
      const signedMessage = qrMessage(merchant, 10n, nonce, expiry);
      try {
        await send(
          await issueTx({ points: 10_000n, nonce, expiry, messageOverride: signedMessage }),
          [customer]
        );
        expect.fail("tampered payload should have been rejected");
      } catch (err: any) {
        expect(String(err)).to.include("QrPayloadMismatch");
      }
    });

    it("rejects amounts above the per-tx cap even when correctly signed", async () => {
      const expiry = (await nowTs()) + 60n;
      try {
        await send(await issueTx({ points: 10_001n, nonce: nextNonce++, expiry }), [customer]);
        expect.fail("cap should have been enforced");
      } catch (err: any) {
        expect(String(err)).to.include("IssueCapExceeded");
      }
    });
  });

  describe("positions", () => {
    const openPosition = async (positionId: bigint, stake: bigint, leverage: number) => {
      const position = positionPda(program.programId, customer.publicKey, vault, positionId);
      await program.methods
        .openPosition(
          new anchor.BN(positionId.toString()),
          new anchor.BN(stake.toString()),
          leverage
        )
        .accounts({
          user: customer.publicKey,
          config,
          vault,
          userProfile: customerProfile,
          position,
          priceUpdate: mockPrice,
          loyalMint,
          userAta: customerAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([customer])
        .rpc();
      return position;
    };

    const closePosition = async (position: PublicKey) => {
      await program.methods
        .closePosition()
        .accounts({
          user: customer.publicKey,
          config,
          vault,
          userProfile: customerProfile,
          position,
          priceUpdate: mockPrice,
          loyalMint,
          userAta: customerAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([customer])
        .rpc();
    };

    it("settles a winning 5x position with the 2% fee burned", async () => {
      // Top up: need points to stake.
      const expiry = (await nowTs()) + 60n;
      await send(await issueTx({ points: 1_000n, nonce: nextNonce++, expiry }), [customer]);
      const before = await balance();

      await setMockPrice(1_000_000n); // 1.00
      const position = await openPosition(0n, 1_000n, 5);
      expect(await balance()).to.equal(before - 1_000n); // stake burned

      await setMockPrice(1_100_000n); // +10% at 5x => 1.5x
      await closePosition(position);
      // payout 1500, fee 2% = 30, net 1470
      expect(await balance()).to.equal(before - 1_000n + 1_470n);

      const profile: any = await (program.account as any).userProfile.fetch(customerProfile);
      expect(profile.degenScore.toNumber()).to.equal(470);
    });

    it("settles a losing 2x position", async () => {
      const before = await balance();
      await setMockPrice(1_000_000n);
      const position = await openPosition(1n, 1_000n, 2);
      await setMockPrice(900_000n); // -10% at 2x => 0.8x
      await closePosition(position);
      // payout 800, fee 16, net 784 => net loss 216
      expect(await balance()).to.equal(before - 216n);
    });

    it("clamps a moonshot at 5x stake", async () => {
      const before = await balance();
      await setMockPrice(1_000_000n);
      const position = await openPosition(2n, 100n, 5);
      await setMockPrice(9_000_000n); // +800% => raw 41x, clamp 5x
      await closePosition(position);
      // payout 500, fee 10, net 490 => +390
      expect(await balance()).to.equal(before + 390n);
    });

    it("rejects leverage outside {1,2,5}", async () => {
      await setMockPrice(1_000_000n);
      try {
        await openPosition(3n, 100n, 3);
        expect.fail("leverage 3 should be rejected");
      } catch (err: any) {
        expect(String(err)).to.include("InvalidLeverage");
      }
    });
  });

  describe("liquidation", () => {
    it("refuses to liquidate a healthy position, then cranks a drowned one", async () => {
      await setMockPrice(1_000_000n);
      const profile: any = await (program.account as any).userProfile.fetch(customerProfile);
      const positionId = BigInt(profile.positionCount.toString());
      const position = positionPda(program.programId, customer.publicKey, vault, positionId);

      await program.methods
        .openPosition(new anchor.BN(positionId.toString()), new anchor.BN(1_000), 5)
        .accounts({
          user: customer.publicKey,
          config,
          vault,
          userProfile: customerProfile,
          position,
          priceUpdate: mockPrice,
          loyalMint,
          userAta: customerAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([customer])
        .rpc();

      const liquidate = () =>
        program.methods
          .liquidatePosition()
          .accounts({
            liquidator: liquidator.publicKey,
            config,
            vault,
            positionOwner: customer.publicKey,
            ownerProfile: customerProfile,
            position,
            priceUpdate: mockPrice,
            loyalMint,
            ownerAta: customerAta,
            liquidatorAta: ataFor(loyalMint, liquidator.publicKey),
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([liquidator])
          .rpc();

      // -15% at 5x: multiplier 0.25 > 0.2 -> NOT liquidatable.
      await setMockPrice(850_000n);
      try {
        await liquidate();
        expect.fail("healthy position must not be liquidatable");
      } catch (err: any) {
        expect(String(err)).to.include("NotLiquidatable");
      }

      // -16% at 5x: multiplier 0.2 -> liquidatable by anyone.
      await setMockPrice(840_000n);
      await liquidate();

      const liqBalance = await connection.getTokenAccountBalance(
        ataFor(loyalMint, liquidator.publicKey)
      );
      expect(BigInt(liqBalance.value.amount)).to.equal(10n); // 1% of 1000

      const after: any = await (program.account as any).userProfile.fetch(customerProfile);
      expect(after.timesLiquidated).to.equal(1);

      const pos: any = await (program.account as any).position.fetch(position);
      expect(Object.keys(pos.status)[0]).to.equal("liquidated");
    });
  });

  describe("marketplace listings", () => {
    it("lets a merchant create a listing at the next listing id", async () => {
      const listing = listingPda(program.programId, merchant, 0n);
      await program.methods
        .createListing("1 Free Coffee", new anchor.BN(500), 100, "https://loyal.fun/rewards/coffee.json")
        .accounts({
          authority: merchantAuthority.publicKey,
          config,
          merchant,
          listing,
          systemProgram: SystemProgram.programId,
        })
        .signers([merchantAuthority])
        .rpc();

      const l: any = await (program.account as any).rewardListing.fetch(listing);
      expect(l.title).to.equal("1 Free Coffee");
      expect(l.pricePoints.toNumber()).to.equal(500);
      expect(l.stock).to.equal(100);
    });
  });

  describe("pause switch", () => {
    it("blocks issuance while paused and resumes after unpause", async () => {
      await program.methods
        .setPaused(true)
        .accounts({ admin: admin.publicKey, config })
        .rpc();

      const expiry = (await nowTs()) + 60n;
      try {
        await send(await issueTx({ points: 10n, nonce: nextNonce++, expiry }), [customer]);
        expect.fail("paused protocol should reject issuance");
      } catch (err: any) {
        expect(String(err)).to.include("Paused");
      }

      await program.methods
        .setPaused(false)
        .accounts({ admin: admin.publicKey, config })
        .rpc();

      await send(
        await issueTx({ points: 10n, nonce: nextNonce++, expiry: (await nowTs()) + 60n }),
        [customer]
      );
    });
  });
});

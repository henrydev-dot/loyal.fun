// Empty stand-in for jito-ts: any named import resolves to an inert class.
module.exports = new Proxy(
  {},
  {
    get: () =>
      class JitoStub {
        constructor() {}
      },
  }
);

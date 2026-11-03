import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from 'expo-crypto';

const algorithms: Readonly<Record<string, CryptoDigestAlgorithm | undefined>> = {
  'SHA-1': CryptoDigestAlgorithm.SHA1,
  'SHA-256': CryptoDigestAlgorithm.SHA256,
  'SHA-384': CryptoDigestAlgorithm.SHA384,
  'SHA-512': CryptoDigestAlgorithm.SHA512
};

// Native protocol dependencies use Web Crypto for digests and randomness.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues,
      randomUUID,
      subtle: {
        async digest(algorithm: AlgorithmIdentifier, data: BufferSource) {
          const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
          const supported = algorithms[name];
          if (!supported) throw new Error(`Unsupported digest algorithm: ${name}`);
          return digest(supported, data);
        }
      }
    }
  });
}

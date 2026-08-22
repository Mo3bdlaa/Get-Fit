import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const R = 8;
const P = 1;

/**
 * scrypt's cost lives in the hash, not only in this constant, so raising it
 * later re-hashes on next sign-in instead of invalidating every password.
 *
 * The test suite lowers it through `SCRYPT_COST_LOG2`: the default costs ~100ms
 * per call by design, and the suite registers users in the hundreds. Nothing
 * else about the code path changes.
 */
function costLog2(): number {
  const configured = Number(process.env.SCRYPT_COST_LOG2);
  return Number.isInteger(configured) && configured >= 10 && configured <= 20
    ? configured
    : 14; // N = 16384
}

function options(n: number) {
  return { N: n, r: R, p: P, maxmem: 256 * n * R };
}

/** Stored as `scrypt$<log2(N)>$<salt-hex>$<key-hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const log2 = costLog2();
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, options(2 ** log2));
  return `scrypt$${log2}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, log2Raw, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !log2Raw || !saltHex || !keyHex) return false;

  const log2 = Number(log2Raw);
  if (!Number.isInteger(log2) || log2 < 10 || log2 > 20) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
    options(2 ** log2),
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

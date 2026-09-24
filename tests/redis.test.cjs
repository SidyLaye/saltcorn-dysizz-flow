/* Le protocole Redis (sans serveur). */
const assert = require("assert");
const { encode, parse } = require("../src/lib/redis");
assert.strictEqual(encode(["SET", "k", "é"]), "*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n");
assert.deepStrictEqual(parse(Buffer.from("+OK\r\n")), ["OK", 5]);
assert.deepStrictEqual(parse(Buffer.from(":42\r\n")), [42, 5]);
assert.deepStrictEqual(parse(Buffer.from("$-1\r\n")), [null, 5]);
assert.deepStrictEqual(parse(Buffer.from("$3\r\nabc\r\n")), ["abc", 9]);
assert.strictEqual(parse(Buffer.from("$3\r\nab")), null, "réponse incomplète");
assert.deepStrictEqual(parse(Buffer.from("*2\r\n$1\r\na\r\n:1\r\n"))[0], ["a", 1]);
assert(parse(Buffer.from("-ERR non\r\n"))[0] instanceof Error);
console.log("redis OK");

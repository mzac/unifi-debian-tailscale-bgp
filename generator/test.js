// node generator/test.js  (from the repo root): the generator's output for the default (example) answers must match
// the files in files/ and the README's UniFi block, so the page and the guide never drift apart.
const fs = require("fs"), path = require("path"), assert = require("assert");
const G = require("./gen.js");
const root = path.join(__dirname, "..");
const rd = (f) => fs.readFileSync(path.join(root, f), "utf8");
let fails = 0;
const check = (name, fn) => { try { fn(); console.log("ok   " + name); } catch (e) { fails++; console.log("FAIL " + name + "\n" + e.message); } };

const v = Object.assign({}, G.DEFAULTS);
check("defaults validate", () => assert.deepStrictEqual(G.validate(v), []));
const repo = {}; G.REPO_FILES.forEach((f) => (repo[f] = rd("files/" + f)));
const out = G.generate(v, repo);
[1, 2].forEach((n) => {
  const r = out.routers[n - 1].files;
  check(`frr ${n} == files/`, () => assert.strictEqual(r["frr.conf"], rd(`files/frr.ts-router${n}.conf`)));
  check(`keepalived ${n} == files/`, () => assert.strictEqual(r["keepalived.conf"], rd(`files/keepalived.ts-router${n}.conf`)));
  check(`conntrackd ${n} == files/`, () => assert.strictEqual(r["conntrackd.conf"], rd(`files/conntrackd.ts-router${n}.conf`)));
  check(`repo files included ${n}`, () => G.REPO_FILES.forEach((f) => assert.ok(r[f], f)));
});
check("ts-maint.default 1 == files/", () => assert.strictEqual(out.routers[0].files["ts-maint.default"], rd("files/ts-maint.default")));
check("UniFi block == README", () => {
  const readme = rd("README.md"), m = /```\n(router bgp 65000[\s\S]*?)```/.exec(readme);
  assert.ok(m, "README UniFi block not found"); assert.strictEqual(out.unifi, m[1]);
});
check("NAT rules == files/rules.v4.nat", () => {
  const nat = rd("files/rules.v4.nat");
  out.nat.forEach(([, r]) => assert.ok(nat.includes("-A POSTROUTING " + r), r));
});
check("tailscale up == README", () => {
  const readme = rd("README.md");
  assert.ok(readme.includes(out.tailscaleUp.replace("tailscale up", "tailscale up")), out.tailscaleUp);
});

const bad = (patch, field) => check(`rejects ${field}: ${JSON.stringify(patch)}`, () => {
  const e = G.validate(Object.assign({}, v, patch)).map((x) => x[0]);
  assert.ok(e.includes(field), "got " + JSON.stringify(e));
});
bad({ vip: "10.99.0.11" }, "vip");
bad({ vip: "10.98.0.10" }, "vip");
bad({ ip2: "10.99.0.255" }, "ip2");
bad({ routes: "192.168.1.0/24" }, "routes");
bad({ routes: "10.10.0.5/24" }, "routes");
bad({ lan: "10.1.0.0/8" }, "lan");
bad({ r2: "other" }, "r2");
bad({ r2: "ts-router1" }, "r2");
bad({ asTs: "65000" }, "asTs");
bad({ vrid: "300" }, "vrid");
bad({ inIf: "ens18" }, "inIf");
bad({ ts1: "10.1.1.1" }, "ts1");
bad({ transit: "10.99.0.0/30" }, "transit");

// optional fields left empty -> placeholders, still valid
const v2 = Object.assign({}, v, { wan1: "", ts1: "", exitNode: false });
check("empty optional fields validate", () => assert.deepStrictEqual(G.validate(v2), []));
const o2 = G.generate(v2, repo);
check("placeholders when empty", () => assert.ok(o2.routers[0].files["conntrackd.conf"].includes("# IPv4_address <tailscale ip -4>")));
check("no exit-node rule when off", () => assert.ok(!o2.nat.some(([, r]) => r.includes("-o ens18"))));

// write a zip + install.sh for the shell checks
fs.mkdirSync("/tmp/gen-out", { recursive: true });
const r1 = out.routers[0];
fs.writeFileSync("/tmp/gen-out/r1.zip", G.zip(Object.keys(r1.files).map((f) => ({ name: r1.name + "/" + f, text: r1.files[f], exec: /\.sh$|^ts-maint$/.test(f) }))));
fs.writeFileSync("/tmp/gen-out/install.sh", r1.files["install.sh"]);
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);

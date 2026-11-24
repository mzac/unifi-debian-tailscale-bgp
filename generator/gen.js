// gen.js: config generator for unifi-debian-tailscale-bgp.
// Pure functions only (no DOM): used by generator/index.html in the browser and by generator/test.js in Node.
// Given the answers from the form, validate() lists problems and generate() returns every file as text.
(function (root) {
  "use strict";

  const DEFAULTS = {
    r1: "ts-router1", r2: "ts-router2",
    lan: "10.0.0.0/8",
    routes: "10.10.0.0/24, 10.20.0.0/24",
    exitNode: true, tsSsh: true,
    transit: "10.99.0.0/24", gw: "10.99.0.1", ip1: "10.99.0.11", ip2: "10.99.0.12", vip: "10.99.0.10",
    wanIf: "ens18", inIf: "ens19",
    wan1: "10.98.0.11", wan2: "10.98.0.12", ts1: "100.64.0.1", ts2: "100.64.0.2",
    asGw: "65000", asTs: "65001", gwId: "10.10.0.1", vrid: "99",
    frrVersion: "10.3", tag: "tag:subnet-router",
  };

  // ---------- IPv4 helpers ----------
  function ip2n(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    const o = m.slice(1).map(Number);
    if (o.some((x) => x > 255)) return null;
    return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
  }
  function n2ip(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."); }
  function cidr(s) {
    const m = /^([\d.]+)\/(\d{1,2})$/.exec(String(s).trim());
    if (!m) return null;
    const ip = ip2n(m[1]), len = Number(m[2]);
    if (ip === null || len > 32) return null;
    const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
    return { net: (ip & mask) >>> 0, len, mask, aligned: ((ip & mask) >>> 0) === ip, text: n2ip((ip & mask) >>> 0) + "/" + len };
  }
  function inNet(ipn, c) { return ((ipn & c.mask) >>> 0) === c.net; }
  function netInNet(a, b) { return a.len >= b.len && inNet(a.net, b); }
  function netmask(len) { return n2ip(len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0); }
  function list(s) { return String(s || "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean); }
  function commonPrefix(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); }

  // ---------- validation ----------
  function validate(v) {
    const e = []; // [field, message]
    const host = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
    if (!host.test(v.r1)) e.push(["r1", "Use a plain hostname: lowercase letters, digits, dashes."]);
    if (!host.test(v.r2)) e.push(["r2", "Use a plain hostname: lowercase letters, digits, dashes."]);
    if (v.r1 === v.r2) e.push(["r2", "The two routers need different names."]);
    else if (commonPrefix(v.r1, v.r2).length < 2) e.push(["r2", "Both names must start the same way (e.g. ts-router1 / ts-router2): ts-maint finds its peer by that prefix."]);

    const lan = cidr(v.lan);
    if (!lan) e.push(["lan", "Enter a CIDR, e.g. 10.0.0.0/8."]);
    else if (!lan.aligned) e.push(["lan", `Not a network address: did you mean ${lan.text}?`]);
    const routes = list(v.routes);
    if (!routes.length) e.push(["routes", "List at least one subnet to reach from the tailnet."]);
    routes.forEach((r) => {
      const c = cidr(r);
      if (!c) e.push(["routes", `"${r}" is not a CIDR.`]);
      else if (!c.aligned) e.push(["routes", `"${r}" is not a network address (${c.text}?).`]);
      else if (lan && !netInNet(c, lan)) e.push(["routes", `${r} is outside the LAN range ${v.lan}: the gateway would never send it.`]);
    });

    const tr = cidr(v.transit);
    if (!tr) e.push(["transit", "Enter a CIDR, e.g. 10.99.0.0/24."]);
    else {
      if (!tr.aligned) e.push(["transit", `Not a network address: did you mean ${tr.text}?`]);
      if (tr.len > 29) e.push(["transit", "Use /29 or larger: the gateway, both routers and the VIP need addresses."]);
      if (lan && !netInNet(tr, lan)) e.push(["transit", `The transit subnet should be inside the LAN range ${v.lan} so the gateway advertises it to the routers.`]);
    }
    const addrs = { gw: "UniFi Gateway", ip1: v.r1 || "router 1", ip2: v.r2 || "router 2", vip: "VIP" };
    const seen = {};
    Object.keys(addrs).forEach((k) => {
      const n = ip2n(v[k]);
      if (n === null) { e.push([k, "Enter an IPv4 address."]); return; }
      if (tr) {
        if (!inNet(n, tr)) e.push([k, `Must be inside the transit subnet ${tr.text}.`]);
        else if (tr.len <= 30 && (n === tr.net || n === ((tr.net | ~tr.mask) >>> 0))) e.push([k, "That's the subnet's network or broadcast address."]);
      }
      if (seen[n]) e.push([k, `Same address as the ${seen[n]}.`]);
      seen[n] = addrs[k];
    });
    ["wan1", "wan2", "ts1", "ts2"].forEach((k) => {
      if (String(v[k] || "").trim() && ip2n(v[k]) === null) e.push([k, "Enter an IPv4 address or leave it empty."]);
    });
    ["ts1", "ts2"].forEach((k) => {
      const n = ip2n(v[k]);
      if (n !== null && !inNet(n, cidr("100.64.0.0/10"))) e.push([k, "Tailscale IPs are in 100.64.0.0/10."]);
    });
    if (ip2n(v.gwId) === null) e.push(["gwId", "The router-id is written as an IPv4 address."]);
    const iface = /^[a-zA-Z0-9_.:-]{1,15}$/;
    if (!iface.test(v.wanIf)) e.push(["wanIf", "Not a valid interface name."]);
    if (!iface.test(v.inIf)) e.push(["inIf", "Not a valid interface name."]);
    if (v.wanIf === v.inIf) e.push(["inIf", "WAN and inside must be different interfaces."]);
    const asn = (s) => /^\d+$/.test(String(s)) && Number(s) >= 1 && Number(s) <= 4294967295;
    if (!asn(v.asGw)) e.push(["asGw", "Enter an AS number."]);
    if (!asn(v.asTs)) e.push(["asTs", "Enter an AS number."]);
    if (String(v.asGw) === String(v.asTs)) e.push(["asTs", "Use a different AS than the gateway: this guide uses eBGP."]);
    if (!/^\d+$/.test(String(v.vrid)) || Number(v.vrid) < 1 || Number(v.vrid) > 255) e.push(["vrid", "1 to 255, unique on that VLAN."]);
    if (!/^\d+(\.\d+){0,2}$/.test(String(v.frrVersion))) e.push(["frrVersion", "e.g. 10.3 (install.sh corrects it to the installed version anyway)."]);
    if (v.tag && !/^tag:[a-z0-9-]+$/.test(v.tag)) e.push(["tag", "Tags look like tag:subnet-router."]);
    return e;
  }

  // ---------- templates ----------
  function frr(v, me) {
    const ip = me === 1 ? v.ip1 : v.ip2, name = me === 1 ? v.r1 : v.r2, lan = cidr(v.lan);
    return `frr version ${v.frrVersion}
frr defaults traditional
hostname ${name}
log syslog informational
service integrated-vtysh-config
!
ip prefix-list lan seq 10 permit ${lan.text} ge ${lan.len}
ip prefix-list tailscale seq 10 permit 100.64.0.0/10 ge 10
!
route-map tailscale permit 10
 match ip address prefix-list tailscale
exit
!
! ts-maint follow (ts-bgp-follow.service) rewrites this metric every second:
! 0 on the Tailscale primary, 200 on the standby. Start as standby.
route-map ts-med permit 10
 set metric 200
exit
!
ip route 100.64.0.0/10 Null0
!
router bgp ${v.asTs}
 bgp router-id ${ip}
 no bgp network import-check
 neighbor ${v.gw} remote-as ${v.asGw}
 neighbor ${v.gw} update-source ${ip}
 neighbor ${v.gw} timers 3 9
 !
 address-family ipv4 unicast
  redistribute static route-map tailscale
  no neighbor ${v.gw} send-community
  neighbor ${v.gw} soft-reconfiguration inbound
  neighbor ${v.gw} prefix-list lan in
  neighbor ${v.gw} prefix-list tailscale out
  neighbor ${v.gw} route-map ts-med out
 exit-address-family
exit
!
end
`;
  }

  function keepalived(v, me) {
    const ip = me === 1 ? v.ip1 : v.ip2, peer = me === 1 ? v.ip2 : v.ip1, name = me === 1 ? v.r1 : v.r2;
    const len = cidr(v.transit).len;
    return `# ${name} -- /etc/keepalived/keepalived.conf
# VRRP VIP ${v.vip} = the shared SNAT address for tailnet -> LAN traffic. It FOLLOWS the Tailscale primary:
# both nodes have priority 100, the track script adds 50 on the primary, preempt is on (the default).
global_defs {
    router_id ${name}
    script_user root
    enable_script_security
    vrrp_garp_master_refresh 60
}
vrrp_script ts_primary {
    script "/usr/local/sbin/ts-maint is-primary"
    interval 1
    timeout 5
    fall 1
    rise 1
    weight 50
}
vrrp_instance TS_VIP {
    state BACKUP
    interface ${v.inIf}
    virtual_router_id ${v.vrid}
    priority 100
    advert_int 1
    unicast_src_ip ${ip}
    unicast_peer {
        ${peer}
    }
    virtual_ipaddress {
        ${v.vip}/${len} dev ${v.inIf} label ${v.inIf}:vip
    }
    track_script {
        ts_primary
    }
    notify_master "/etc/conntrackd/primary-backup.sh primary"
    notify_backup "/etc/conntrackd/primary-backup.sh backup"
    notify_fault  "/etc/conntrackd/primary-backup.sh fault"
}
`;
  }

  function conntrackd(v, me) {
    const ip = me === 1 ? v.ip1 : v.ip2, peer = me === 1 ? v.ip2 : v.ip1, name = me === 1 ? v.r1 : v.r2;
    const wan = String((me === 1 ? v.wan1 : v.wan2) || "").trim(), ts = String((me === 1 ? v.ts1 : v.ts2) || "").trim();
    const own = [];
    own.push(`            # this router's ${v.wanIf} (WAN, DHCP: reserve it)`);
    own.push(wan ? `            IPv4_address ${wan}` : `            # IPv4_address <this router's WAN address>   (fill in, then: systemctl restart conntrackd)`);
    own.push(`            # this router's Tailscale IP (tailscale ip -4)`);
    own.push(ts ? `            IPv4_address ${ts}` : `            # IPv4_address <tailscale ip -4>   (known after 'tailscale up'; fill in, then: systemctl restart conntrackd)`);
    return `# ${name} -- /etc/conntrackd/conntrackd.conf
# Syncs the connection/NAT table to the peer (FTFW over unicast UDP on the BGP transit VLAN), so after a failover
# the new VRRP master already has every SNAT mapping (tailnet 100.x -> ${v.vip}:port) and sessions continue.
Sync {
    Mode FTFW {
        DisableExternalCache Off
        CommitTimeout 1800
        PurgeTimeout 5
    }
    UDP {
        IPv4_address ${ip}
        IPv4_Destination_Address ${peer}
        Port 3780
        Interface ${v.inIf}
        SndSocketBuffer 1249280
        RcvSocketBuffer 1249280
        Checksum on
    }
}
General {
    Systemd on
    HashSize 32768
    HashLimit 131072
    LogFile on
    Syslog on
    LockFile /var/lock/conntrack.lock
    UNIX {
        Path /var/run/conntrackd.ctl
    }
    NetlinkBufferSize 2097152
    NetlinkBufferSizeMaxGrowth 8388608
    Filter From Userspace {
        Protocol Accept {
            TCP
            UDP
            ICMP
        }
        # The routers' own traffic (BGP, SSH to them, WireGuard, DNS) is not forwarded: don't sync it.
        # List 127.0.0.1, both inside addresses, THIS router's WAN (ens18) address and its own Tailscale IP.
        Address Ignore {
            IPv4_address 127.0.0.1
            IPv4_address ${v.ip1}
            IPv4_address ${v.ip2}
${own.join("\n")}
        }
    }
}
`;
  }

  function tsDefault(v, me) {
    const peer = me === 1 ? v.ip2 : v.ip1;
    return `# /etc/default/ts-maint (sourced by /usr/local/sbin/ts-maint)
GW=${v.gw}            # UniFi Gateway on the BGP transit VLAN
AS=${v.asTs}
VIP=${v.vip}
VIP_DEV=${v.inIf}
NAME_PREFIX=${commonPrefix(v.r1, v.r2)}   # both routers' Tailscale hostnames start with this
PEER_IP=${peer}      # the OTHER router
`;
  }

  function interfaces(v, me) {
    const ip = me === 1 ? v.ip1 : v.ip2, len = cidr(v.transit).len;
    return `# /etc/network/interfaces (${me === 1 ? v.r1 : v.r2})
auto lo
iface lo inet loopback

auto ${v.wanIf}
iface ${v.wanIf} inet dhcp

auto ${v.inIf}
iface ${v.inIf} inet static
    address ${ip}
    netmask ${netmask(len)}
# No gateway on ${v.inIf}: the default route comes from WAN DHCP.
`;
  }

  function natRules(v) {
    const lan = cidr(v.lan);
    const r = [
      ["LAN -> tailnet: appear as this router's Tailscale IP", `-s ${lan.text} -o tailscale0 -j MASQUERADE`],
    ];
    if (v.exitNode) r.push(["exit node: tailnet -> internet via WAN", `-s 100.64.0.0/10 -o ${v.wanIf} -j MASQUERADE`]);
    r.push(["tailnet -> LAN: SNAT to the shared VIP (state synced by conntrackd)", `-s 100.64.0.0/10 -o ${v.inIf} -j SNAT --to-source ${v.vip}`]);
    return r;
  }

  function tailscaleUp(v) {
    const routes = list(v.routes).map((r) => cidr(r).text);
    const tr = cidr(v.transit).text;
    if (!routes.includes(tr)) routes.push(tr);
    const lines = ["tailscale up", `  --advertise-routes=${routes.join(",")}`];
    if (v.exitNode) lines.push("  --advertise-exit-node");
    lines.push("  --snat-subnet-routes=false", "  --accept-routes=false");
    if (v.tsSsh) lines.push("  --ssh");
    return lines.join(" \\\n");
  }

  function unifi(v) {
    const lan = cidr(v.lan), n = [v.ip1, v.ip2];
    return `router bgp ${v.asGw}
 bgp router-id ${v.gwId}
${n.map((ip) => ` neighbor ${ip} remote-as ${v.asTs}\n neighbor ${ip} timers 3 9`).join("\n")}
 !
 address-family ipv4 unicast
  redistribute connected
${n.map((ip) => `  neighbor ${ip} soft-reconfiguration inbound\n  neighbor ${ip} prefix-list tailscale in\n  neighbor ${ip} prefix-list lan out`).join("\n")}
 exit-address-family
exit
!
ip prefix-list lan seq 10 permit ${lan.text} ge ${lan.len}
ip prefix-list tailscale seq 10 permit 100.64.0.0/10 ge 10
`;
  }

  function policy(v) {
    const tag = v.tag || "tag:subnet-router";
    const lan = cidr(v.lan).text;
    return `// Tailscale policy file: let the routers' routes be approved automatically.
// Merge into your existing "tagOwners" and "autoApprovers".
"tagOwners": {
  "${tag}": ["autogroup:admin"],
},
"autoApprovers": {
  "routes":   { "${lan}": ["${tag}"] },${v.exitNode ? `\n  "exitNode": ["${tag}"],` : ""}
},
// Then add --advertise-tags=${tag} to tailscale up on both routers
// (or tag them in the admin console).`;
  }

  function installSh(v, me) {
    const name = me === 1 ? v.r1 : v.r2, ip = me === 1 ? v.ip1 : v.ip2;
    const rules = natRules(v).map(([c, r]) => `    # ${c}\n    add_rule ${r}`).join("\n");
    return `#!/bin/bash
# install.sh for ${name}: generated by the unifi-debian-tailscale-bgp config generator.
# Copies the files in this folder into place and enables the services. It does NOT:
#   - change /etc/network/interfaces (see interfaces.example; set ${v.inIf} to ${ip} first, it refuses otherwise)
#   - log in to Tailscale (run the tailscale up command it prints at the end)
#   - touch the UniFi Gateway (paste the UniFi BGP config from the generator)
# Re-running it is safe: existing files are backed up first, rules are only added when missing.
# Usage: sudo ./install.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"
DRY=0; [ "\${1:-}" = "--dry-run" ] && DRY=1
run() { echo "+ $*"; [ "$DRY" = 1 ] || "$@"; }
die() { echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"
grep -qi debian /etc/os-release || die "this targets Debian (12/13)"
[ "$(hostname -s)" = "${name}" ] || echo "WARNING: hostname is $(hostname -s), these files are for ${name} (hostnamectl set-hostname ${name})"
ip -4 -o addr show dev ${v.inIf} 2>/dev/null | grep -q " ${ip}/" ||
    die "${v.inIf} does not have ${ip}: configure it first (interfaces.example), then re-run"

BK=/root/ts-setup-backup-$(date +%Y%m%d-%H%M%S)
put() {   # put <src> <dest> <mode>
    if [ -e "$2" ] && cmp -s "$1" "$2"; then echo "  unchanged $2"; return; fi
    if [ -e "$2" ]; then run mkdir -p "$BK$(dirname "$2")"; run cp -p "$2" "$BK$2"; fi
    run install -D -m "$3" "$1" "$2"
}

echo "== packages"
run env DEBIAN_FRONTEND=noninteractive apt-get update -q
echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | { [ "$DRY" = 1 ] || debconf-set-selections; }
echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | { [ "$DRY" = 1 ] || debconf-set-selections; }
run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q frr frr-pythontools keepalived conntrackd iptables-persistent ethtool python3 curl

echo "== forwarding"
put sysctl-forwarding.conf /etc/sysctl.d/99-forwarding.conf 0644
run sysctl -q --system

echo "== FRR"
if [ "$DRY" = 0 ]; then
    ver=$(vtysh --version 2>/dev/null | sed -n 's/^vtysh \\([0-9.]*\\).*/\\1/p' | head -1)
    [ -n "$ver" ] && sed -i "1s/^frr version .*/frr version $ver/" frr.conf
fi
put frr.conf /etc/frr/frr.conf 0640
run chown frr:frr /etc/frr/frr.conf
grep -q '^bgpd=yes' /etc/frr/daemons || run sed -i 's/^bgpd=no/bgpd=yes/' /etc/frr/daemons

echo "== ts-maint"
put ts-maint /usr/local/sbin/ts-maint 0755
put ts-maint.default /etc/default/ts-maint 0644
put ts-bgp-follow.service /etc/systemd/system/ts-bgp-follow.service 0644
put ts-maint-restore.service /etc/systemd/system/ts-maint-restore.service 0644
put ts-role.sh /etc/profile.d/ts-role.sh 0644

echo "== keepalived + conntrackd"
put keepalived.conf /etc/keepalived/keepalived.conf 0644
put conntrackd.conf /etc/conntrackd/conntrackd.conf 0644
put primary-backup.sh /etc/conntrackd/primary-backup.sh 0755
put conntrackd.service.override.conf /etc/systemd/system/conntrackd.service.d/override.conf 0644
put keepalived.service.override.conf /etc/systemd/system/keepalived.service.d/override.conf 0644

echo "== NAT rules"
add_rule() { iptables -t nat -C POSTROUTING "$@" 2>/dev/null && echo "  present: $*" || run iptables -t nat -A POSTROUTING "$@"; }
${rules.replace(/^    /gm, "")}
run netfilter-persistent save

echo "== Tailscale"
if ! command -v tailscale >/dev/null; then
    if [ "$DRY" = 1 ]; then echo "+ curl -fsSL https://tailscale.com/install.sh | sh"; else curl -fsSL https://tailscale.com/install.sh | sh; fi
fi
put tailscale-ethtool.service /etc/systemd/system/tailscale-ethtool.service 0644

echo "== services"
run systemctl daemon-reload
run systemctl enable tailscale-ethtool ts-bgp-follow ts-maint-restore frr conntrackd keepalived
run systemctl restart tailscale-ethtool frr conntrackd keepalived ts-bgp-follow

cat <<'NEXT'

Done. Next:
 1. Log in to Tailscale (prints a URL to open):

${tailscaleUp(v).replace(/^/gm, "    ")}

 2. Approve the routes${v.exitNode ? " and exit node" : ""} in the Tailscale admin console (or use the autoApprovers snippet).
 3. Do the same on the other router, and paste the UniFi BGP config.
 4. Check: ts-maint status ; vtysh -c "show bgp summary" ; systemctl --failed
NEXT
[ -n "$BK" ] && [ -d "$BK" ] && echo "Backups of replaced files: $BK"
exit 0
`;
  }

  const STATIC_TEXT = {
    "sysctl-forwarding.conf": "net.ipv4.ip_forward = 1\nnet.ipv4.conf.all.forwarding = 1\nnet.ipv6.conf.all.forwarding = 1\n",
  };

  function ethtoolUnit(v) {
    return `[Unit]
Description=Tailscale ethtool UDP GRO fix
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/sbin/ethtool -K ${v.wanIf} rx-udp-gro-forwarding on rx-gro-list off
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;
  }

  // Files every router needs as-is from the repo's files/ folder.
  const REPO_FILES = ["ts-maint", "primary-backup.sh", "ts-bgp-follow.service", "ts-maint-restore.service",
    "ts-role.sh", "conntrackd.service.override.conf", "keepalived.service.override.conf"];

  // Returns { unifi, policy, tailscaleUp, nat: [[comment, rule]], routers: [{name, files: {path: text}}] }.
  // `repo` maps REPO_FILES names to their text (fetched by the page); missing ones are left out.
  function generate(v, repo) {
    repo = repo || {};
    const routers = [1, 2].map((me) => {
      const files = {
        "install.sh": installSh(v, me),
        "frr.conf": frr(v, me),
        "keepalived.conf": keepalived(v, me),
        "conntrackd.conf": conntrackd(v, me),
        "ts-maint.default": tsDefault(v, me),
        "interfaces.example": interfaces(v, me),
        "tailscale-ethtool.service": ethtoolUnit(v),
        "sysctl-forwarding.conf": STATIC_TEXT["sysctl-forwarding.conf"],
      };
      REPO_FILES.forEach((f) => { if (repo[f] != null) files[f] = repo[f]; });
      return { name: me === 1 ? v.r1 : v.r2, files };
    });
    return { unifi: unifi(v), policy: policy(v), tailscaleUp: tailscaleUp(v), nat: natRules(v), routers };
  }

  // ---------- tiny ZIP writer (store, no compression) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // entries: [{name, text, exec}] -> Uint8Array
  function zip(entries) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    entries.forEach((e) => {
      const name = enc.encode(e.name), data = enc.encode(e.text), crc = crc32(data);
      const local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(local), name, data);
      const mode = (e.exec ? 0o100755 : 0o100644) << 16;
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(0x0314), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(mode >>> 0), u32(off))), name);
      off += local.length + name.length + data.length;
    });
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdSize), u32(off), u16(0)));
    const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0; all.forEach((a) => { out.set(a, p); p += a.length; });
    return out;
  }

  const api = { DEFAULTS, REPO_FILES, validate, generate, zip, crc32, cidr, ip2n };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TSGen = api;
})(this);

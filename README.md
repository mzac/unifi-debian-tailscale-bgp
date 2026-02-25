# unifi-pfsense-tailscale

Guide on how to integrate Unifi with pfSense and Tailscale using OSPF

## Introduction

This guide will show you how to integrate Unifi with pfSense and Tailscale using OSPF. This will allow you to reach devices in your tailnet from your Unifi network and vice versa.

### How It Works

At a high level, the traffic flow looks like this:

```
LAN Device → Unifi Gateway → (OSPF) → pfSense → (Tailscale tunnel) → Remote Device
```

The Unifi Gateway handles your local network routing as usual. pfSense sits alongside it with two connections: one for internet access (WAN) and one peering with the Unifi Gateway via OSPF (LAN). Tailscale runs on pfSense and creates the overlay network to your remote devices.

OSPF is used to dynamically exchange routes between the Unifi Gateway and pfSense. pfSense advertises the Tailscale subnet (`100.64.0.0/10`) to the Unifi Gateway via OSPF, so your LAN devices know to route Tailscale-bound traffic through pfSense. In the other direction, pfSense learns all your Unifi network routes via OSPF, so it can route return traffic back to the correct VLAN.

Since Tailscale nodes won't have routes back to your RFC 1918 address space, pfSense performs outbound NAT to translate your LAN source addresses to its own Tailscale IP. This makes return traffic work seamlessly — remote Tailscale devices see traffic coming from pfSense's Tailscale address and know how to respond.

## Network Diagram

![Network Diagram](images/network-diagram.png)

## Requirements

* A medium to advanced understanding of networking and routing protocols
* pfSense (physical or virtual) with at least 2 interfaces or VLANs
* Unifi Gateway
* Tailscale tailnet
* Tailscale client on a remote device
* SSH access to pfSense and Unifi Gateway

## Not Covered

* Installing pfSense
* Installing a Unifi Gateway
* Setting up a Tailscale tailnet
* Installing Tailscale client on a remote device

## Important Notes

By using OSPF on Unifi, this may not allow you to use Unifi Site Magic as it requires OSPF to be disabled.

## Unifi Configuration

On your Unifi Gateway, you will need to configure the following:

* Create two networks/VLANs
  + One for the Outside network for pfSense to connect to the Internet
  + One for the Inside network for pfSense to peer with the Unifi Gateway with OSPF
  + Both networks should use static IP addresses
  + In the example below we will use the following IP ranges:
    - Tailscale tailnet: `100.64.0.0/10`
    - Unifi Networks: `192.168.0.0/16`
    - Outside network: `192.168.220.0/24`
    - Inside network: `192.168.221.0/24`
    - pfSense WAN IP: `192.168.220.11`
    - pfSense LAN IP: `192.168.221.11`

> **Note:** pfSense needs to be connected to both VLANs, either via two physical interfaces or two tagged VLANs on a single trunk port. If running pfSense as a VM, assign two virtual NICs — one on each VLAN.

### Unifi OSPF Configuration

Under Settings -> Routing -> OSPF tab, click on `Create New` and configure the following:

* Area ID: `0.0.0.0`
* Area Type: `Normal`
* Network: `Inside network`
* Networks: `pfSense Inside network`

### Unifi IP Group Configuration

Under Settings -> Profiles -> IP Groups, create a new IP group for Tailscale:

* Profile Name: `Tailscale`
* Type: `IPv4 Address/Subnet`
* Address: `100.64.0.0/10`

### Unifi Firewall Rule

Under Settings -> Security -> Traffic & Firewall Rules, configure the following rule using advanced settings:

* Type: `LAN In`
* Name: `Allow LAN to Tailscale`
* Action: `Accept`
* Protocol: `All`
* Source Type: `Network`
* Network: `Your LAN network(s)`
* Network Type: `IPv4 Subnet`
* Destination Type: `Port/IP Group`
* Address Group: `Tailscale`
* Port Group: `Any`

## pfSense Configuration

On your pfSense, install the following packages:

* FRR
* Tailscale

### pfSense Tailscale Configuration

Under VPN -> Tailscale, connect your pfSense to the Tailscale tailnet.

You can follow these instructions for setting up Tailscale on pfSense: <https://flemmingss.com/how-to-set-up-tailscale-on-pfsense/>

Once Tailscale is up, make sure to advertise your routes to the Tailscale tailnet.

You can optionally advertise as an exit node as well.

![Tailscale Advertise Routes](images/pfsense-tailscale-routes.png)

### Tailscale Configuration

#### Tailscale Admin Console Settings

On your Tailscale admin console:

* Disable key expiry
* Edit route settings to allow all subnets
* Optionally, enable exit node

![Tailscale Route Settings](images/tailscale-routes.png)

#### Tailscale Access Control

You can also edit your Access Control settings to allow all devices to communicate with each other. This can be customized to your needs so it will not be covered in this guide but you can follow the Tailscale documentation.

<https://tailscale.com/kb/1337/acl-syntax>

### pfSense FRR Configuration

#### FRR Global Settings

Under Services -> FRR Global/Zebra, configure the following:

* Enable FRR
* Master Password: `Your password`
* Route Handling:
  + Null Route
  + Subnet: `100.64.0.0/10`
  + Static Route Target: `None`
  + Then click on `Add`

![FRR Route Handling](images/frr-route-handling.png)

#### FRR Prefix Lists

Under Services -> FRR Global/Zebra -> Prefix Lists, configure the following:

Click on `Add` and configure the following:

* General Options
  + IP Type: `IPv4`
  + Name: `tailscale`
  + Prefix List Entries:
    - Sequence: `10`
    - Action: `Permit`
    - Network: `100.64.0.0/10`
    - Minimum Prefix: `10`

![FRR Prefix Lists](images/frr-prefix-list.png)

#### FRR Route Maps

Under Services -> FRR Global/Zebra -> Route Maps, configure the following:

Click on `Add` and configure the following:

* General Options
  + Name: `tailscale`
  + Action: `Permit`
  + Sequence: `10`
* Prefix Lists
  + Match Prefix List: `tailscale`

#### FRR OSPF

Under Services -> FRR OSPF, configure the following:

* Enable OSPF Routing
* Log Adjacency Changes
* Router ID: `The Static IP address of the pfSense interface that is connected to the Unifi Gateway on the Inside network`
* Route Redistribution
  + FRR Static Routes
    - Redistribute FRR Static
    - Metric: `10`
    - Route Map: `tailscale`

#### FRR OSPF Interfaces

Under Services -> FRR OSPF -> Interfaces, configure the following by clicking on `Add`:

* Interface: `lan`
* Ignore MTU: `Checked`
* Area: `0.0.0.0`

### NAT Configuration

Under Firewall -> NAT, configure the following:

* Outbound NAT Mode: `Manual Outbound NAT rule generation`
* Under mappings, click on `Add` and configure the following rule:

  + Interface: `Tailscale`
  + Address Family: `IPv4`
  + Protocol: `Any`
  + Source:
    - Type: `Network or Alias`
    - Source Network for the outbound NAT Mapping: `The IP range and mask of your networks on unifi (ex. 192.168.0.0/16)`
  + Destination:
    - Type: `Network or Alias`
    - Destination Network for the outbound NAT Mapping: `100.64.0.0/10`
  + Translation:
    - Type: `Network or Alias`
    - Address: `The Tailscale Tailnet IP address of your pfSense appliance (ex. 100.64.0.231/32)`

> **Why NAT?** Tailscale nodes on your tailnet won't have routes back to your private RFC 1918 address space (e.g. `192.168.x.x`). By NATing outbound traffic to pfSense's Tailscale IP, remote devices see traffic originating from an address they can route back to, making bidirectional communication work seamlessly.

![NAT Rule](images/nat-rule.png)

Save the rule and apply the changes.

**IMPORTANT: Make sure to move the rule to the top of the list.**

### Firewall Rules

Under Firewall -> Rules -> LAN, add a rule to allow traffic from the LAN to the Tailscale subnet:

* Action: `Pass`
* Interface: `LAN`
* Address Family: `IPv4`
* Protocol: `Any`
* Source: `LAN net`
* Destination: `Network or Alias` - `100.64.0.0/10`

![Firewall Rule](images/firewall-rule-lan-tailscale.png)

Save the rule and apply the changes.

## OSPF Verification

### pfSense

SSH into your pfSense appliance and verify that the OSPF peering is working by running the following command:

```
vtysh -c 'show ip ospf neighbor'
```

You should see the Unifi Gateway as a neighbor.

```
[2.7.2-RELEASE][root@pf1]/root: vtysh -c 'show ip ospf neigh'

Neighbor ID     Pri State           Up Time         Dead Time Address         Interface                        RXmtL RqstL DBsmL
192.168.221.1     1 Full/DROther    2d12h07m          32.952s 192.168.221.1   vtnet1:192.168.221.11                0     0     0
```

To check that pfSense is learning routes from the Unifi Gateway, run the following command:

```
vtysh -c 'show ip route ospf'
```

You should see the routes that the Unifi Gateway is advertising.

```
[2.7.2-RELEASE][root@pf1]/root: vtysh -c 'show ip route ospf'
Codes: K - kernel route, C - connected, S - static, R - RIP,
       O - OSPF, I - IS-IS, B - BGP, E - EIGRP, T - Table,
       v - VNC, V - VNC-Direct, A - Babel, f - OpenFabric,
       > - selected route, * - FIB route, q - queued, r - rejected, b - backup
       t - trapped, o - offload failure

O>* 10.37.110.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O   100.64.0.0/10 [110/100] via 192.168.221.12, vtnet1, weight 1, 02w6d22h
O>* 192.168.0.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.2.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.3.0/24 [110/20] via 192.168.221.12, vtnet1, weight 1, 22:24:43
O>* 192.168.10.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.25.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.26.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.40.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.120.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.200.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.201.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.202.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O   192.168.220.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O   192.168.221.0/24 [110/10] is directly connected, vtnet1, weight 1, 02w6d22h
O>* 192.168.230.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.231.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.240.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.241.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.242.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
O>* 192.168.254.0/24 [110/20] via 192.168.221.1, vtnet1, weight 1, 2d12h09m
```

### Unifi Gateway

SSH into your Unifi Gateway and verify that the OSPF peering is working by running the following command:

```
vtysh -c 'show ip ospf neighbor'
```

You should see the pfSense firewall as a neighbor.

```
root@Gateway:~# vtysh -c 'show ip ospf neighbor'

Neighbor ID     Pri State           Dead Time Address         Interface                        RXmtL RqstL DBsmL
192.168.221.11    1 Full/DR           31.282s 192.168.221.11  br221:192.168.221.1                  0     0     0
```

To check that the Unifi Gateway is learning routes from pfSense, run the following command:

```
vtysh -c 'show ip route ospf'
```

```
root@Gateway:~# vtysh -c 'show ip route ospf'
Codes: K - kernel route, C - connected, S - static, O - OSPF,
       B - BGP, T - Table, f - OpenFabric,
       > - selected route, * - FIB route, q - queued, r - rejected, b - backup
       t - trapped, o - offload failure

O>* 100.64.0.0/10 [110/10] via 192.168.221.11, br221, weight 1, 2d13h09m
O   192.168.221.0/24 [110/1] is directly connected, br221, weight 1, 2d13h09m
```

## Tailscale DNS Configuration

If you want to leverage Tailscale DNS for your network, you can configure your DNS server to forward requests for your tailnet domain to the Tailscale DNS server.

For example, if you're running Unbound on pfSense (the default DNS resolver), you can add a domain override under Services -> DNS Resolver -> Domain Overrides:

* Domain: `ts.net` (or your tailnet's MagicDNS domain)
* Lookup Server IP Address: `100.100.100.100`
* Description: `Tailscale MagicDNS`

This allows LAN clients to resolve Tailscale hostnames (e.g. `myphone.tail1234.ts.net`) through your local DNS infrastructure.

See the following guides for more information:

* <https://tailscale.com/kb/1081/magicdns>
* <https://tailscale.com/kb/1381/what-is-quad100>

## Optional Configurations

### pfSense High Availability

If you want to have multiple pfSense appliances in a high availability configuration (for upgrades, reboots etc), you can follow these steps:

#### Tailscale HA Configuration

* Ensure that both pfSense appliances are connected to Tailscale
* Advertise the same routes to the Tailscale tailnet from both pfSense appliances

> **How HA failover works:** Both pfSense nodes advertise the same Tailscale routes and run OSPF with the Unifi Gateway. The primary node uses a lower OSPF metric (the default `10` from earlier), while the backup uses a higher metric (`100`). Under normal operation, the Unifi Gateway prefers the primary's lower-cost route. If the primary goes down, OSPF detects the neighbor loss and the Unifi Gateway automatically shifts traffic to the backup's higher-cost route. On the Tailscale side, both nodes advertise the same subnets — Tailscale will use the primary route advertiser and failover to the backup when the primary becomes unreachable.

#### CARP Configuration

Configure CARP on the WAN or LAN interface on the first pfSense appliance with the following settings:

* Synchronize admin
* User manager, users and groups
* Authentication servers
* Firewall rules
* Firewall aliases
* DNS Forwarder and Resolver configuration

#### FRR OSPF Configuration

Configure FRR OSPF on both pfSense appliances with the same settings but modify the following on the **backup** node:

* Under Services -> FRR OSPF -> Route Distribution

  + FRR Static Routes
    - Metric: `100`
* Under Services -> FRR OSPF -> Interfaces -> LAN

  + OSPF Interface Handling
  + Metric: `1000`

## Troubleshooting

### OSPF Adjacency Not Forming

* **MTU mismatch:** Ensure both sides of the OSPF link have the same MTU, or check `Ignore MTU` in the FRR OSPF interface settings on pfSense.
* **Firewall blocking OSPF:** OSPF uses multicast (`224.0.0.5` and `224.0.0.6`) on protocol 89. Ensure no firewall rules are blocking this on the Inside network interface.
* **Wrong area:** Both pfSense and the Unifi Gateway must be configured in the same OSPF area (`0.0.0.0`).
* **Interface mismatch:** Verify that the correct interface is selected in FRR OSPF settings and that it corresponds to the Inside network VLAN.

### LAN Devices Can't Reach Tailscale Nodes

* **Check OSPF routes on Unifi:** SSH into the Unifi Gateway and run `vtysh -c 'show ip route ospf'` — you should see `100.64.0.0/10` pointing to pfSense.
* **Check NAT rule order:** The outbound NAT rule must be at the **top** of the list. pfSense evaluates NAT rules top-down and uses the first match.
* **Check Tailscale route approval:** In the Tailscale admin console, verify that the advertised routes from pfSense are approved.
* **Check pfSense firewall rules:** Ensure the LAN rule allowing traffic to `100.64.0.0/10` exists and is above any block rules.

### Tailscale Nodes Can't Reach LAN Devices

* **NAT not working:** Verify the outbound NAT rule is translating source addresses correctly. You can check with packet captures on the Tailscale interface in pfSense (Diagnostics -> Packet Capture).
* **Return routing:** Ensure pfSense has OSPF routes back to your Unifi subnets — run `vtysh -c 'show ip route ospf'` on pfSense to confirm.

## Conclusion

You should now have a working OSPF configuration between your pfSense and Unifi Gateway. To test the configuration, try pinging devices on the other side of the network to verify that they can communicate with each other.

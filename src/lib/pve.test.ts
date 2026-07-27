import { describe, expect, it } from "vitest";
import {
  ipFromCloudInitConfig,
  ipFromCloudInitDump,
  ipFromLxcConfig,
  ipFromVmConfig,
  isPrivateIpv4,
  selectGuestIp,
  selectLxcIp,
  vmConfigMacs,
} from "./pve";

describe("PVE guest IP selection", () => {
  it("prefers an RFC1918 address and ignores loopback/link-local addresses", () => {
    expect(selectGuestIp([
      { name: "lo", "ip-addresses": [{ "ip-address": "127.0.0.1" }] },
      { name: "eth0", "ip-addresses": [{ "ip-address": "203.0.113.4" }, { "ip-address": "10.12.0.8" }] },
    ])).toBe("10.12.0.8");
  });

  it("parses static cloud-init addresses but rejects DHCP", () => {
    expect(ipFromCloudInitConfig("ip=10.1.2.3/24,gw=10.1.2.1")).toBe("10.1.2.3");
    expect(ipFromCloudInitConfig("ip=dhcp")).toBeNull();
    expect(isPrivateIpv4("172.31.2.4")).toBe(true);
    expect(isPrivateIpv4("172.32.2.4")).toBe(false);
  });

  it("prefers the interface matching a configured VM MAC", () => {
    const config = {
      net0: "virtio=BC:24:11:FA:59:67,bridge=vmbr1",
      ipconfig0: "ip=dhcp",
    };
    expect(selectGuestIp([
      { name: "docker0", "hardware-address": "02:42:ac:11:00:01", "ip-addresses": [{ "ip-address": "172.17.0.1" }] },
      { name: "ens18", "hardware-address": "bc:24:11:fa:59:67", "ip-addresses": [{ "ip-address": "192.168.103.3" }] },
    ], vmConfigMacs(config))).toBe("192.168.103.3");
    expect(selectGuestIp([
      { name: "docker0", "hardware-address": "02:42:ac:11:00:01", "ip-addresses": [{ "ip-address": "172.17.0.1" }] },
      { name: "ens18", "hardware-address": "bc:24:11:fa:59:67", "ip-addresses": [{ "ip-address": "100.115.61.58" }] },
    ], vmConfigMacs(config))).toBe("100.115.61.58");
  });

  it("scans all cloud-init NICs and generated network data", () => {
    expect(ipFromVmConfig({ ipconfig0: "ip=dhcp", ipconfig1: "ip=10.20.30.40/24,gw=10.20.30.1" })).toBe("10.20.30.40");
    expect(ipFromCloudInitDump("subnets:\n  - type: static\n    address: 192.168.50.9/24\n")).toBe("192.168.50.9");
    expect(ipFromCloudInitConfig("ip=dhcp,ip6=fd00::12/64")).toBe("fd00::12");
  });

  it("reads LXC runtime and static config addresses", () => {
    expect(selectLxcIp([{ name: "eth0", inet: "10.0.5.8/24" }])).toBe("10.0.5.8");
    expect(ipFromLxcConfig({ net0: "name=eth0,bridge=vmbr0,ip=10.0.5.9/24,type=veth" })).toBe("10.0.5.9");
  });
});

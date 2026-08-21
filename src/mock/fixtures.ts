import type {
  CucmCallingSearchSpace,
  CucmCallManagerGroup,
  CucmDevicePool,
  CucmExternalCallControlProfile,
  CucmLine,
  CucmNode,
  CucmPhone,
  CucmRouteGroup,
  CucmRouteList,
  CucmRoutePartition,
  CucmRoutePattern,
  CucmSipTrunk,
  CucmState,
  CucmTopologySwitch,
  CucmUser,
  CurriPolicy,
  SeedFixturesInput,
  SupportedAxlVersion,
} from "../types/domain.js";

/**
 * Deterministic seeded pseudo-random number generator.
 */
export function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

/**
 * Creates the standard "lab-small" fixture containing a dual-node CUCM cluster,
 * 12 Cisco IP phones, dial plans, CUBE SIP trunk, and default CURRI policies.
 */
export function createLabSmallFixture(
  version: SupportedAxlVersion = "14.0",
  phoneIpBase = "192.168.125.100",
  seed = 42
): CucmState {
  const rand = createSeededRandom(seed);

  const nodes: CucmNode[] = [
    {
      name: "CUCM-PUB",
      ipv4Address: "192.168.125.10",
      role: "publisher",
      version,
      risReturnCode: "Ok",
    },
    {
      name: "CUCM-SUB1",
      ipv4Address: "192.168.125.11",
      role: "subscriber",
      version,
      risReturnCode: "Ok",
    },
  ];

  const callManagerGroups: CucmCallManagerGroup[] = [
    {
      name: "Default_CMG",
      members: [
        { nodeName: "CUCM-PUB", priority: 1 },
        { nodeName: "CUCM-SUB1", priority: 2 },
      ],
    },
    {
      name: "SubOnly_CMG",
      members: [
        { nodeName: "CUCM-SUB1", priority: 1 },
        { nodeName: "CUCM-PUB", priority: 2 },
      ],
    },
  ];

  const routePartitions: CucmRoutePartition[] = [
    { name: "Internal_PT", description: "Internal extensions", usage: "line" },
    { name: "PSTN_PT", description: "Outbound PSTN route partition", usage: "route" },
    { name: "Emergency_PT", description: "Emergency dial routing", usage: "route" },
  ];

  const css: CucmCallingSearchSpace[] = [
    {
      name: "Internal_CSS",
      description: "Standard internal calling search space",
      routePartitionNames: ["Internal_PT", "Emergency_PT", "PSTN_PT"],
    },
    {
      name: "Restricted_CSS",
      description: "Restricted internal-only calling",
      routePartitionNames: ["Internal_PT"],
    },
  ];

  const devicePools: CucmDevicePool[] = [
    {
      name: "HQ_DP",
      callManagerGroupName: "Default_CMG",
      locationName: "HQ",
      networkLocale: "United_States",
      regionName: "Default",
    },
    {
      name: "Branch_DP",
      callManagerGroupName: "SubOnly_CMG",
      locationName: "Branch1",
      networkLocale: "United_States",
      regionName: "Default",
    },
  ];

  const sipTrunks: CucmSipTrunk[] = [
    {
      name: "CUBE_Trunk",
      description: "Cisco CUBE IOS-XE SIP Trunk",
      nodeName: "CUCM-PUB",
      destinationAddress: "192.168.125.20",
      destinationPort: 5060,
      transport: "udp",
      status: "up",
      routePartitionName: "PSTN_PT",
      protocol: "SIP",
    },
  ];

  const routeGroups: CucmRouteGroup[] = [
    {
      name: "CUBE_RG",
      description: "CUBE PSTN Gateway Route Group",
      distributionAlgorithm: "top-down",
      members: [{ trunkName: "CUBE_Trunk", priority: 1 }],
    },
  ];

  const routeLists: CucmRouteList[] = [
    {
      name: "PSTN_RL",
      description: "Outbound PSTN Route List",
      routeGroupNames: ["CUBE_RG"],
    },
  ];

  const routePatterns: CucmRoutePattern[] = [
    {
      name: "PSTN_9_11",
      pattern: "911",
      description: "Emergency 911 dialing",
      partitionName: "Emergency_PT",
      targetKind: "route-list",
      targetName: "PSTN_RL",
      provideOutsideDialTone: false,
    },
    {
      name: "PSTN_National",
      pattern: "9.1[2-9]XXXXXXXXX",
      description: "Outbound 10-digit PSTN calls",
      partitionName: "PSTN_PT",
      targetKind: "route-list",
      targetName: "PSTN_RL",
      stripLeadingDigits: 2,
    },
  ];

  const policies: CurriPolicy[] = [
    {
      id: "permit-default",
      name: "Default Permit",
      apiKey: "policy-default",
      enabled: true,
      priority: 1000,
      match: {},
      action: { type: "permit", reason: "Standard allowed call" },
    },
    {
      id: "block-fraud",
      name: "Fraud Blacklist",
      apiKey: "policy-fraud",
      enabled: true,
      priority: 10,
      match: { callingPrefix: "900", calledPrefix: "900" },
      action: { type: "block", reason: "Blocked by Fraud Protection Policy" },
    },
    {
      id: "redirect-vip",
      name: "Executive VIP Redirect",
      apiKey: "policy-vip",
      enabled: true,
      priority: 50,
      match: { calledPrefix: "1099" },
      action: { type: "redirect", reason: "Executive Assistant Divert", redirectNumber: "1001" },
    },
  ];

  const eccProfiles: CucmExternalCallControlProfile[] = [
    {
      name: "CallTelemetry_ECC",
      uuid: "{ECC00001-0000-0000-0000-000000000001}",
      description: "Call Telemetry CURRI Policy Engine Profile",
      primaryUri: "http://192.168.125.50:8080/curri",
      enableLoadBalancing: false,
      callTreatmentOnFailure: "Allow Calls",
      linkedPolicyId: "permit-default",
      destinationUrl: "http://192.168.125.50:8080/curri",
      destinationPort: 8080,
      active: true,
    },
  ];

  const users: CucmUser[] = [
    {
      userid: "jdoe",
      firstName: "John",
      lastName: "Doe",
      displayName: "John Doe",
      uuid: "{USR00001-0000-0000-0000-000000000001}",
      status: "active",
      mailid: "jdoe@example.com",
      telephoneNumber: "1001",
      associatedDevices: ["SEP001122334455"],
    },
    {
      userid: "asmith",
      firstName: "Alice",
      lastName: "Smith",
      displayName: "Alice Smith",
      uuid: "{USR00002-0000-0000-0000-000000000002}",
      status: "active",
      mailid: "asmith@example.com",
      telephoneNumber: "1002",
      associatedDevices: ["SEP001122334456"],
    },
  ];

  const lines: CucmLine[] = [];
  const phones: CucmPhone[] = [];

  const models = [
    { model: 36248, modelName: "Cisco 8845", prefix: "SEP" as const, os: "classic" as const, kind: "hardware" as const },
    { model: 36214, modelName: "Cisco 7841", prefix: "SEP" as const, os: "classic" as const, kind: "hardware" as const },
    { model: 36249, modelName: "Cisco 8865", prefix: "SEP" as const, os: "classic" as const, kind: "hardware" as const },
    { model: 503, modelName: "Cisco Unified Client Services Framework", prefix: "CSF" as const, os: "phoneos" as const, kind: "softphone" as const },
  ];

  const baseOctets = phoneIpBase.split(".").map(Number);

  for (let i = 1; i <= 12; i++) {
    const ext = String(1000 + i);
    const macHex = i.toString(16).padStart(12, "0").toUpperCase();
    const modelInfo = models[(i - 1) % models.length];
    const phoneName = `${modelInfo.prefix}${macHex}`;
    const ip = `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2]}.${baseOctets[3] + i - 1}`;
    const isRegistered = i <= 9; // 75% registered

    const lineId = `line-${ext}`;
    lines.push({
      id: lineId,
      pattern: ext,
      partitionName: "Internal_PT",
      description: `Line for ${ext}`,
      phoneName,
      label: `Ext ${ext}`,
      callingSearchSpaceName: "Internal_CSS",
      externalCallControlProfileName: "CallTelemetry_ECC",
    });

    const status = isRegistered ? "Registered" : (i === 10 ? "UnRegistered" : "Rejected");

    phones.push({
      name: phoneName,
      description: `Lab Phone ${i} (${modelInfo.modelName})`,
      dirNumber: ext,
      linePartitionName: "Internal_PT",
      lineIds: [lineId],
      callingSearchSpaceName: "Internal_CSS",
      ipAddress: ip,
      status,
      protocol: "SIP",
      activeLoadId: "sip88xx.14-0-1-0101-29",
      model: modelInfo.model,
      modelName: modelInfo.modelName,
      nodeName: isRegistered ? (i % 2 === 0 ? "CUCM-SUB1" : "CUCM-PUB") : "CUCM-PUB",
      devicePoolName: i % 2 === 0 ? "Branch_DP" : "HQ_DP",
      callManagerGroupName: i % 2 === 0 ? "SubOnly_CMG" : "Default_CMG",
      ownerUserId: i === 1 ? "jdoe" : (i === 2 ? "asmith" : undefined),
      locationName: i % 2 === 0 ? "Branch1" : "HQ",
      phoneOs: modelInfo.os,
      endpointKind: modelInfo.kind,
      deviceNamePrefix: modelInfo.prefix,
      fixtureFamily: "8800",
      firmware: "sip88xx.14-0-1-0101-29",
      firmwareGroup: "sip88xx",
      serialNumber: `FOC2${String(100000 + i)}`,
      network: {
        macAddress: macHex.match(/.{1,2}/g)!.join(":"),
        ipv4Address: ip,
        subnetMask: "255.255.255.0",
        defaultGateway: `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2]}.1`,
        dnsServers: ["192.168.125.1"],
        domainName: "lab.calltelemetry.local",
        switchName: "SW-ACCESS-01",
        switchIpAddress: "192.168.125.2",
        switchModel: "WS-C2960X-24PD-L",
        switchPort: `GigabitEthernet1/0/${i}`,
        poeClass: "Class 4 (30.0W)",
        neighborProtocol: "both",
        cdpNeighborDeviceId: "SW-ACCESS-01",
        cdpNeighborIpAddress: "192.168.125.2",
        cdpNeighborPort: `GigabitEthernet1/0/${i}`,
        stats: {
          rxPackets: 15000 + Math.floor(rand() * 5000),
          txPackets: 14800 + Math.floor(rand() * 5000),
          rxBroadcast: 120,
          rxMulticast: 80,
          txBroadcast: 45,
          txMulticast: 30,
          crcErrors: 0,
          collisions: 0,
          jitterMs: 1.2 + rand() * 2,
          latencyMs: 8.5 + rand() * 4,
          packetLossPct: 0.0,
        },
      },
      web: {
        htmlFlavor: "classic",
        locale: "en_us",
        supportsScreenshots: true,
        supportsServiceability: true,
        supportsNetworkPages: true,
        supportsClassicExecute: true,
        supportsXapi: false,
      },
      statusMessages: [
        "12:00:00 Initializing network",
        "12:00:02 TFTP Config retrieved successfully",
        "12:00:05 Registered with CUCM",
      ],
      qualityEvents: [],
      risNodeRegistrations: [
        {
          nodeName: i % 2 === 0 ? "CUCM-SUB1" : "CUCM-PUB",
          status,
          statusReason: isRegistered ? "Registered" : "Keepalive timeout",
          ipAddress: ip,
          protocol: "SIP",
          activeLoadId: "sip88xx.14-0-1-0101-29",
          timeStamp: Date.now() - 3600000,
        },
      ],
      externalCallControlProfileName: "CallTelemetry_ECC",
      callLoadEnabled: true,
      callLoadCallsPerHour: 10,
      emitCdrRecords: true,
      emitCmrRecords: true,
      emitCurriEvents: true,
    });
  }

  const switches: CucmTopologySwitch[] = [
    {
      name: "SW-ACCESS-01",
      managementIpAddress: "192.168.125.2",
      model: "WS-C2960X-24PD-L",
      site: "HQ",
      ports: Array.from({ length: 24 }, (_, idx) => ({
        id: `GigabitEthernet1/0/${idx + 1}`,
        vlanId: idx < 12 ? 100 : 1,
        speedMbps: 1000,
        duplex: "full",
        poeClass: "Class 4 (30.0W)",
        connectedDeviceName: idx < 12 ? phones[idx]?.name : undefined,
        connectedIpAddress: idx < 12 ? phones[idx]?.ipAddress : undefined,
      })),
    },
  ];

  return {
    clusterName: "CT-LAB-CLUSTER",
    version,
    nodes,
    phones,
    lines,
    users,
    devicePools,
    callManagerGroups,
    routePartitions,
    css,
    routePatterns,
    routeGroups,
    routeLists,
    sipTrunks,
    policies,
    eccProfiles,
    switches,
  };
}

/**
 * Creates a larger enterprise fixture with 4 cluster nodes and 50 phones.
 */
export function createEnterpriseFixture(
  version: SupportedAxlVersion = "14.0",
  phoneIpBase = "10.100.0.10",
  seed = 100
): CucmState {
  const base = createLabSmallFixture(version, phoneIpBase, seed);

  // Add more nodes
  base.nodes.push(
    {
      name: "CUCM-SUB2",
      ipv4Address: "192.168.125.12",
      role: "subscriber",
      version,
      risReturnCode: "Ok",
    },
    {
      name: "CUCM-TFTP",
      ipv4Address: "192.168.125.13",
      role: "subscriber",
      version,
      risReturnCode: "Ok",
    }
  );

  // Expand phones up to 50
  const rand = createSeededRandom(seed);
  const baseOctets = phoneIpBase.split(".").map(Number);

  for (let i = 13; i <= 50; i++) {
    const ext = String(2000 + i);
    const macHex = (i + 1000).toString(16).padStart(12, "0").toUpperCase();
    const phoneName = `SEP${macHex}`;
    const ip = `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2] + Math.floor(i / 250)}.${(baseOctets[3] + i) % 254}`;
    const isRegistered = i <= 45;

    const lineId = `line-${ext}`;
    base.lines.push({
      id: lineId,
      pattern: ext,
      partitionName: "Internal_PT",
      description: `Line for ${ext}`,
      phoneName,
      callingSearchSpaceName: "Internal_CSS",
      externalCallControlProfileName: "CallTelemetry_ECC",
    });

    const status = isRegistered ? "Registered" : "UnRegistered";
    const assignedNode = base.nodes[i % base.nodes.length].name;

    base.phones.push({
      name: phoneName,
      description: `Enterprise Phone ${i} (Cisco 8851)`,
      dirNumber: ext,
      linePartitionName: "Internal_PT",
      lineIds: [lineId],
      callingSearchSpaceName: "Internal_CSS",
      ipAddress: ip,
      status,
      protocol: "SIP",
      activeLoadId: "sip88xx.14-0-1-0101-29",
      model: 36247,
      modelName: "Cisco 8851",
      nodeName: assignedNode,
      devicePoolName: i % 2 === 0 ? "Branch_DP" : "HQ_DP",
      callManagerGroupName: "Default_CMG",
      locationName: "HQ",
      phoneOs: "classic",
      endpointKind: "hardware",
      deviceNamePrefix: "SEP",
      fixtureFamily: "8800",
      firmware: "sip88xx.14-0-1-0101-29",
      firmwareGroup: "sip88xx",
      serialNumber: `FOC2${String(200000 + i)}`,
      network: {
        macAddress: macHex.match(/.{1,2}/g)!.join(":"),
        ipv4Address: ip,
        subnetMask: "255.255.255.0",
        defaultGateway: `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2]}.1`,
        dnsServers: ["192.168.125.1"],
        domainName: "enterprise.calltelemetry.local",
        switchName: "SW-ACCESS-02",
        switchIpAddress: "192.168.125.3",
        switchModel: "WS-C3850-48P",
        switchPort: `GigabitEthernet1/0/${(i % 48) + 1}`,
        poeClass: "Class 4 (30.0W)",
        neighborProtocol: "both",
        stats: {
          rxPackets: 20000 + Math.floor(rand() * 10000),
          txPackets: 19500 + Math.floor(rand() * 10000),
          rxBroadcast: 200,
          rxMulticast: 150,
          txBroadcast: 50,
          txMulticast: 40,
          crcErrors: 0,
          collisions: 0,
          jitterMs: 1.0 + rand() * 2,
          latencyMs: 5.0 + rand() * 3,
          packetLossPct: 0.0,
        },
      },
      web: {
        htmlFlavor: "classic",
        locale: "en_us",
        supportsScreenshots: true,
        supportsServiceability: true,
        supportsNetworkPages: true,
        supportsClassicExecute: true,
        supportsXapi: false,
      },
      statusMessages: ["Registered with CUCM"],
      qualityEvents: [],
      risNodeRegistrations: [
        {
          nodeName: assignedNode,
          status,
          statusReason: "Registered",
          ipAddress: ip,
          protocol: "SIP",
          timeStamp: Date.now() - 7200000,
        },
      ],
      callLoadEnabled: true,
      callLoadCallsPerHour: 15,
      emitCdrRecords: true,
      emitCmrRecords: true,
      emitCurriEvents: true,
    });
  }

  return base;
}

/**
 * Creates custom fixtures based on seed input options.
 */
export function createCustomFixture(input: SeedFixturesInput): CucmState {
  const profile = input.fixtureProfile || "lab-small";
  const version = input.version || "14.0";
  const seed = input.seed || 42;

  if (profile === "standard-enterprise") {
    return createEnterpriseFixture(version, "10.100.0.10", seed);
  }

  return createLabSmallFixture(version, "192.168.125.100", seed);
}

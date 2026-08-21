/**
 * Domain entity types and DTOs for @calltelemetry/cucm-emulator-mcp
 */

export type SupportedAxlVersion =
  | "11.5"
  | "12.0"
  | "12.5"
  | "14.0"
  | "15.0";

// --- Nodes ---
export type CucmNodeRole = "publisher" | "subscriber";
export type CucmRisNodeReturnCode = "Ok" | "NotFound" | "SearchLimitExceeded";

export interface CucmNode {
  name: string;
  ipv4Address: string;
  role: CucmNodeRole;
  version: SupportedAxlVersion;
  risReturnCode: CucmRisNodeReturnCode;
}

// --- Phones ---
export type CucmPhoneStatus = "Registered" | "UnRegistered" | "Rejected" | "Unknown";
export type CucmPhoneProtocol = "SCCP" | "SIP" | "Any" | "Unknown";
export type CucmPhoneOs = "classic" | "java" | "phoneos" | "roomos";
export type CucmEndpointKind = "hardware" | "softphone" | "bot" | "tablet" | "room-device";
export type CucmDeviceNamePrefix = "SEP" | "CSF" | "BOT" | "TCT" | "ROOM";
export type CucmPhoneHtmlFlavor = "classic" | "serviceability" | "roomos";
export type CucmPhoneSeverity = "info" | "warning" | "critical";
export type CucmNeighborDiscoveryProtocol = "none" | "cdp" | "lldp" | "both";

export interface CucmPhoneNetworkStats {
  rxPackets: number;
  txPackets: number;
  rxBroadcast: number;
  rxMulticast: number;
  txBroadcast: number;
  txMulticast: number;
  crcErrors: number;
  collisions: number;
  jitterMs: number;
  latencyMs: number;
  packetLossPct: number;
}

export interface CucmPhoneQualityEvent {
  severity: CucmPhoneSeverity;
  code: string;
  message: string;
  occurredAt: string;
}

export interface CucmPhoneNetworkIdentity {
  macAddress: string;
  ipv4Address: string;
  ipv6Address?: string;
  subnetMask: string;
  defaultGateway: string;
  dnsServers: string[];
  domainName: string;
  vlanId?: number;
  switchName: string;
  switchIpAddress: string;
  switchModel: string;
  switchPort: string;
  poeClass?: string;
  neighborProtocol: CucmNeighborDiscoveryProtocol;
  cdpNeighborDeviceId?: string;
  cdpNeighborIpAddress?: string;
  cdpNeighborPort?: string;
  lldpNeighborDeviceId?: string;
  lldpNeighborIpAddress?: string;
  lldpNeighborPort?: string;
  stats: CucmPhoneNetworkStats;
}

export interface CucmPhoneWebFeatures {
  htmlFlavor: CucmPhoneHtmlFlavor;
  locale: string;
  supportsScreenshots: boolean;
  supportsServiceability: boolean;
  supportsNetworkPages: boolean;
  supportsClassicExecute: boolean;
  supportsXapi: boolean;
}

export interface CucmRisNodeRegistration {
  nodeName: string;
  status: CucmPhoneStatus;
  statusReason: string;
  ipAddress?: string;
  protocol?: CucmPhoneProtocol;
  activeLoadId?: string;
  timeStamp: number;
}

export interface CucmPhone {
  name: string;
  description: string;
  dirNumber: string;
  linePartitionName: string;
  lineIds?: string[];
  callingSearchSpaceName?: string;
  ipAddress: string;
  status: CucmPhoneStatus;
  protocol: CucmPhoneProtocol;
  activeLoadId: string;
  model: number;
  modelName: string;
  nodeName: string;
  devicePoolName: string;
  callManagerGroupName: string;
  ownerUserId?: string;
  locationName?: string;
  phoneOs: CucmPhoneOs;
  endpointKind: CucmEndpointKind;
  deviceNamePrefix: CucmDeviceNamePrefix;
  fixtureFamily: string;
  firmware: string;
  firmwareGroup: string;
  serialNumber: string;
  network: CucmPhoneNetworkIdentity;
  web: CucmPhoneWebFeatures;
  statusMessages: string[];
  qualityEvents: CucmPhoneQualityEvent[];
  risNodeRegistrations: CucmRisNodeRegistration[];
  externalCallControlProfileName?: string;
  callLoadEnabled: boolean;
  callLoadCallsPerHour: number;
  emitCdrRecords: boolean;
  emitCmrRecords: boolean;
  emitCurriEvents: boolean;
}

// --- Dial Plan & Inventory ---
export interface CucmLine {
  id: string;
  pattern: string;
  partitionName: string;
  description?: string;
  phoneName?: string;
  label?: string;
  callingSearchSpaceName: string;
  externalCallControlProfileName?: string;
}

export interface CucmRoutePartition {
  name: string;
  description?: string;
  usage: "line" | "route";
}

export interface CucmCallingSearchSpace {
  name: string;
  description?: string;
  routePartitionNames: string[];
}

export interface CucmDevicePool {
  name: string;
  callManagerGroupName: string;
  locationName: string;
  networkLocale: string;
  regionName?: string;
}

export interface CucmCallManagerGroupMember {
  nodeName: string;
  priority: number;
}

export interface CucmCallManagerGroup {
  name: string;
  members: CucmCallManagerGroupMember[];
}

export interface CucmRoutePattern {
  name: string;
  pattern: string;
  description?: string;
  partitionName: string;
  targetKind: "phone" | "sip-trunk" | "route-list";
  targetName: string;
  stripLeadingDigits?: number;
  prefixDigitsOut?: string;
  calledPartyTransformationMask?: string;
  provideOutsideDialTone?: boolean;
}

export interface CucmRouteGroupMember {
  trunkName: string;
  priority: number;
}

export interface CucmRouteGroup {
  name: string;
  description?: string;
  distributionAlgorithm: "top-down" | "circular";
  members: CucmRouteGroupMember[];
}

export interface CucmRouteList {
  name: string;
  description?: string;
  routeGroupNames: string[];
}

export interface CucmSipTrunk {
  name: string;
  description?: string;
  nodeName: string;
  destinationAddress: string;
  destinationPort: number;
  transport: "udp" | "tcp" | "tls";
  status: "up" | "down";
  routePartitionName?: string;
  protocol: "SIP";
}

export interface CucmUser {
  userid: string;
  firstName: string;
  lastName: string;
  displayName: string;
  uuid?: string;
  status?: "active" | "inactive";
  accountLocked?: boolean;
  department?: string;
  mailid?: string;
  telephoneNumber?: string;
  associatedDevices: string[];
}

// --- CURRI / External Call Control ---
export type CurriPolicyActionType = "permit" | "block" | "redirect" | "deny" | "divert";

export interface CucmExternalCallControlProfile {
  name: string;
  uuid: string;
  description?: string;
  primaryUri: string;
  secondaryUri?: string;
  enableLoadBalancing: boolean;
  callTreatmentOnFailure: "Allow Calls" | "Block Calls";
  linkedPolicyId?: string;
  destinationUrl: string;
  destinationPort: number;
  routeString?: string;
  active: boolean;
}

export interface CurriPolicy {
  id: string;
  name: string;
  apiKey?: string;
  description?: string;
  enabled: boolean;
  priority: number;
  match: {
    callingPrefix?: string;
    calledPrefix?: string;
    deviceNamePattern?: string;
    userId?: string;
    nodeName?: string;
  };
  action: {
    type: CurriPolicyActionType;
    reason: string;
    redirectNumber?: string;
  };
}

export interface CurriEvaluationInput {
  callingNumber: string;
  calledNumber: string;
  deviceName?: string;
  nodeName?: string;
  userId?: string;
}

export interface CurriDecision {
  matched: boolean;
  action: CurriPolicyActionType;
  reason: string;
  policyId?: string;
  policyName?: string;
  redirectNumber?: string;
}

export interface CucmCurriEvent {
  id: string;
  timestamp: number;
  callingNumber: string;
  calledNumber: string;
  deviceName: string;
  action: CurriPolicyActionType;
  reason: string;
  policyId?: string;
  redirectNumber?: string;
}

// --- Call Sessions & Simulation ---
export type CucmCallSessionState =
  | "created"
  | "route-resolved"
  | "policy-pending"
  | "policy-allowed"
  | "policy-blocked"
  | "policy-redirected"
  | "ringing"
  | "connected"
  | "media-established"
  | "disconnected";

export interface CucmCallLeg {
  id: string;
  direction: "source" | "destination" | "redirect";
  deviceName: string;
  nodeName?: string;
  directoryNumber: string;
  partitionName: string;
  ipAddress?: string;
  protocol?: CucmPhoneProtocol;
  state: "created" | "ringing" | "connected" | "disconnected" | "blocked";
}

export interface CucmMediaLeg {
  id: string;
  callLegId: string;
  deviceName: string;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  octetsSent: number;
  octetsReceived: number;
  jitterMs: number;
  latencyMs: number;
  packetLossPct: number;
  codec: string;
  vqMetrics: string;
}

export interface CucmPolicyEvaluation {
  id: string;
  requestedAt: number;
  resolvedAt: number;
  policyId?: string;
  policyName?: string;
  action: CurriPolicyActionType;
  reason: string;
  redirectNumber?: string;
}

export interface CucmCallRouting {
  routePatternMatched?: string;
  partitionMatched?: string;
  targetKind: "phone" | "sip-trunk" | "route-list" | "unallocated";
  targetName: string;
  transformedCalledNumber: string;
}

export interface CucmCallSessionEvent {
  id: string;
  type: string;
  timestamp: number;
  payload?: Record<string, string | number | boolean | null>;
}

export interface CucmCallSessionArtifacts {
  cdrRecordIds: string[];
  cmrRecordIds: string[];
  curriEventIds: string[];
  auditLogIds: string[];
}

export interface CucmCallSession {
  id: string;
  globalCallID_callManagerId: number;
  globalCallID_callId: number;
  globalCallId_ClusterID: string;
  state: CucmCallSessionState;
  startedAt: number;
  setupAt?: number;
  connectedAt?: number;
  mediaEstablishedAt?: number;
  disconnectedAt?: number;
  disconnectReason?: string;
  sourceDeviceName: string;
  sourceNodeName: string;
  sourceLineId?: string;
  sourceUserId?: string;
  callingNumber: string;
  calledNumber: string;
  finalCalledNumber: string;
  externalCallControlProfileName?: string;
  routing: CucmCallRouting;
  events: CucmCallSessionEvent[];
  legs: CucmCallLeg[];
  mediaLegs: CucmMediaLeg[];
  policyEvaluations: CucmPolicyEvaluation[];
  artifacts: CucmCallSessionArtifacts;
}

export interface SimulateCallInput {
  callingNumber: string;
  calledNumber: string;
  sourceDeviceName?: string;
  destinationDeviceName?: string;
  duration?: number;
  codec?: "G.711u" | "G.711a" | "G.729" | "G.722" | "OPUS";
  packetLossPct?: number;
  packetLossPercent?: number;
  jitterMs?: number;
  latencyMs?: number;
  disconnectReason?: string;
  curriProfileName?: string;
}

export interface SimulatedCallResult {
  sessionId: string;
  state: CucmCallSessionState;
  callingNumber: string;
  calledNumber: string;
  finalCalledNumber: string;
  sourceDeviceName: string;
  destinationDeviceName: string;
  duration: number;
  curriDecision?: CurriDecision;
  cdrRecordId?: string;
  cmrRecordId?: string;
  callSession: CucmCallSession;
  routing?: CucmCallRouting;
  media?: CucmMediaLeg[];
  cdr?: CucmCdrRecord;
}

export interface ExecuteCallActionInput {
  sessionId: string;
  action: "answer" | "hold" | "resume" | "drop";
  reason?: string;
}

// --- CDR & CMR Records ---
export interface CucmCdrRecord {
  id: string;
  callId: string;
  cdrRecordType: number;
  globalCallID_callManagerId: number;
  globalCallID_callId: number;
  origLegCallIdentifier: string;
  dateTimeOrigination: number;
  origNodeId: number;
  origSpan: number;
  origIpAddr: string;
  callingPartyNumber: string;
  callingPartyUnicodeLoginUserID: string;
  origCause_location: number;
  origCause_value: number;
  destLegIdentifier: string;
  destNodeId: number;
  destSpan: number;
  destIpAddr: string;
  originalCalledPartyNumber: string;
  finalCalledPartyNumber: string;
  finalCalledPartyUnicodeLoginUserID: string;
  destCause_location: number;
  destCause_value: number;
  dateTimeConnect: number;
  dateTimeDisconnect: number;
  duration: number;
  pkid: string;
  originalCalledPartyNumberPartition: string;
  callingPartyNumberPartition: string;
  finalCalledPartyNumberPartition: string;
  lastRedirectDnPartition: string;
  origDeviceName: string;
  destDeviceName: string;
  globalCallId_ClusterID: string;
  callSecuredStatus: string;
  lastRedirectDn: string;
  currentRoutingReason: string;
  origRoutingReason: string;
  lastRedirectingRoutingReason: number;
  huntPilotPartition: string;
  huntPilotDN: string;
  calledPartyPatternUsage: number;
  outpulsedCallingPartyNumber: string;
  outpulsedCalledPartyNumber: string;
  outpulsedOriginalCalledPartyNumber: string;
  origIpv4v6Addr: string;
  destIpv4v6Addr: string;
  OutgoingProtocolID: number;
  OutgoingProtocolCallRef: string;
  originalCalledPartyPattern: string;
  finalCalledPartyPattern: string;
  origDeviceType: string;
  destDeviceType: string;
  origDeviceSessionID: string;
  destDeviceSessionID: string;
  routePatternName?: string;
  sipTrunkName?: string;
  externalCallControlProfileName?: string;
  policyId?: string;
}

export interface CucmCmrRecord {
  id: string;
  callId: string;
  cdrRecordType: number;
  globalCallID_callManagerId: number;
  globalCallID_callId: number;
  nodeId: number;
  directoryNum: string;
  callIdentifier: number;
  dateTimeStamp: number;
  numberPacketsSent: number;
  numberOctetsSent: number;
  numberPacketsReceived: number;
  numberOctetsReceived: number;
  numberPacketsLost: number;
  jitter: number;
  latency: number;
  pkid: string;
  directoryNumPartition: string;
  globalCallId_ClusterID: string;
  deviceName: string;
  varVQMetrics: string;
  duration: number;
}

export interface GenerateCdrInput {
  pattern?: "normal" | "burst" | "abandoned" | "curri-blocked" | "toll-fraud" | string;
  count?: number;
  callingNumberPrefix?: string;
  calledNumberPrefix?: string;
  durationMin?: number;
  durationMax?: number;
  packetLossMax?: number;
}

export interface GenerateCdrResult {
  generatedCount: number;
  count?: number;
  pattern: string;
  cdrRecords: CucmCdrRecord[];
  records?: CucmCdrRecord[];
  cmrRecords: CucmCmrRecord[];
}

// --- Topology & Fixtures ---
export interface CucmTopologySwitchPort {
  id: string;
  vlanId?: number;
  speedMbps: number;
  duplex: "half" | "full";
  poeClass?: string;
  connectedDeviceName?: string;
  connectedIpAddress?: string;
}

export interface CucmTopologySwitch {
  name: string;
  managementIpAddress: string;
  model: string;
  site: string;
  ports: CucmTopologySwitchPort[];
}

export interface SeedFixturesInput {
  fixtureProfile?: "lab-small" | "standard-enterprise" | "generated";
  profile?: "lab-small" | "standard-enterprise" | "generated";
  nodeCount?: number;
  phoneCount?: number;
  registeredPercent?: number;
  userCount?: number;
  seed?: number;
  version?: SupportedAxlVersion;
}

export interface ResetStoreInput {
  mode?: "soft" | "hard";
  profile?: "lab-small" | "standard-enterprise" | "empty";
}

export interface CucmSnapshotManifest {
  id: string;
  name: string;
  schemaVersion: string;
  createdAt: string;
  emulatorVersion: string;
  clusterVersion: SupportedAxlVersion;
  clusterName: string;
  entityCounts: Record<string, number>;
}

export interface CucmAuditLogEvent {
  id: string;
  timestamp: number;
  nodeName: string;
  severity: number;
  eventType: string;
  resourceAccessed: string;
  eventStatus: "Success" | "Warning" | "Failure";
  userId: string;
  clientAddress: string;
  details: string;
}

// Full State
export interface CucmState {
  clusterName: string;
  version: SupportedAxlVersion;
  nodes: CucmNode[];
  phones: CucmPhone[];
  lines: CucmLine[];
  users: CucmUser[];
  devicePools: CucmDevicePool[];
  callManagerGroups: CucmCallManagerGroup[];
  routePartitions: CucmRoutePartition[];
  css: CucmCallingSearchSpace[];
  routePatterns: CucmRoutePattern[];
  routeGroups: CucmRouteGroup[];
  routeLists: CucmRouteList[];
  sipTrunks: CucmSipTrunk[];
  policies: CurriPolicy[];
  eccProfiles: CucmExternalCallControlProfile[];
  switches: CucmTopologySwitch[];
}

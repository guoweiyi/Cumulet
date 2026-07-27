import "server-only";
import type { PveFirewallRule } from "./pve";
import type { PveClient } from "./pve";
import {
  planRuleSync,
  referencedFirewallObjects,
  sameText,
  type SyncMode,
} from "./firewall-sync-core";

type GroupSnapshot = { name: string; comment?: string; rules: PveFirewallRule[] };
type IpsetSnapshot = {
  name: string;
  comment?: string;
  entries: { cidr: string; comment?: string; nomatch?: number }[];
};
type AliasSnapshot = { name: string; cidr: string; comment?: string };

export type FirewallSnapshot = {
  groups: GroupSnapshot[];
  ipsets: IpsetSnapshot[];
  aliases: AliasSnapshot[];
};

export type FirewallSyncChanges = {
  groupsCreated: number;
  groupsUpdated: number;
  rulesAdded: number;
  rulesMoved: number;
  rulesUpdated: number;
  rulesRemoved: number;
  ipsetsCreated: number;
  ipsetsUpdated: number;
  entriesAdded: number;
  entriesUpdated: number;
  entriesRemoved: number;
  aliasesCreated: number;
  aliasesUpdated: number;
  objectsRemoved: number;
};

function emptyChanges(): FirewallSyncChanges {
  return {
    groupsCreated: 0,
    groupsUpdated: 0,
    rulesAdded: 0,
    rulesMoved: 0,
    rulesUpdated: 0,
    rulesRemoved: 0,
    ipsetsCreated: 0,
    ipsetsUpdated: 0,
    entriesAdded: 0,
    entriesUpdated: 0,
    entriesRemoved: 0,
    aliasesCreated: 0,
    aliasesUpdated: 0,
    objectsRemoved: 0,
  };
}

export async function readFirewallSnapshot(
  client: PveClient,
  groupName?: string,
): Promise<FirewallSnapshot> {
  const groups = (await client.listGroups()).filter((group) => !groupName || group.group === groupName);
  if (groupName && groups.length === 0) throw new Error("source_group_not_found");
  const groupSnapshots = await Promise.all(
    groups.map(async (group) => ({
      name: group.group,
      comment: group.comment,
      rules: await client.listGroupRules(group.group),
    })),
  );

  const [ipsets, aliases] = await Promise.all([client.listIpsets(), client.listAliases()]);
  const references = groupName
    ? referencedFirewallObjects(
        groupSnapshots.flatMap((group) => group.rules),
        ipsets.map((ipset) => ipset.name),
        aliases.map((alias) => alias.name),
      )
    : null;
  const selectedIpsets = references
    ? ipsets.filter((ipset) => references.ipsets.has(ipset.name))
    : ipsets;
  const ipsetSnapshots = await Promise.all(
    selectedIpsets.map(async (ipset) => ({
      name: ipset.name,
      comment: ipset.comment,
      entries: await client.listIpsetEntries(ipset.name),
    })),
  );
  return {
    groups: groupSnapshots,
    ipsets: ipsetSnapshots,
    aliases: references
      ? aliases.filter((alias) => references.aliases.has(alias.name))
      : aliases,
  };
}

async function syncRules(
  client: PveClient,
  group: GroupSnapshot,
  mode: SyncMode,
  changes: FirewallSyncChanges,
) {
  const current = await client.listGroupRules(group.name);
  const operations = planRuleSync(group.rules, current, mode);
  for (const operation of operations) {
    if (operation.kind === "add") {
      await client.addGroupRule(group.name, { ...operation.rule, pos: operation.pos });
      changes.rulesAdded += 1;
    } else if (operation.kind === "move") {
      await client.moveGroupRule(group.name, operation.from, operation.to);
      changes.rulesMoved += 1;
    } else if (operation.kind === "update") {
      await client.updateGroupRule(group.name, operation.pos, operation.rule);
      changes.rulesUpdated += 1;
    } else {
      await client.deleteGroupRule(group.name, operation.pos);
      changes.rulesRemoved += 1;
    }
  }
}

export async function applyFirewallSnapshot(
  client: PveClient,
  snapshot: FirewallSnapshot,
  mode: SyncMode,
  selectedGroup?: string,
): Promise<FirewallSyncChanges> {
  const changes = emptyChanges();
  // Create dependencies before rules so source/destination references resolve.
  const targetAliases = await client.listAliases();
  const targetAliasMap = new Map(targetAliases.map((alias) => [alias.name, alias]));
  for (const alias of snapshot.aliases) {
    const current = targetAliasMap.get(alias.name);
    if (!current) {
      await client.createAlias(alias.name, alias.cidr, alias.comment);
      changes.aliasesCreated += 1;
    } else if (current.cidr !== alias.cidr || !sameText(current.comment, alias.comment)) {
      await client.updateAlias(alias.name, alias.cidr, alias.comment);
      changes.aliasesUpdated += 1;
    }
  }

  const targetIpsets = await client.listIpsets();
  const targetIpsetMap = new Map(targetIpsets.map((ipset) => [ipset.name, ipset]));
  for (const ipset of snapshot.ipsets) {
    const target = targetIpsetMap.get(ipset.name);
    if (!target) {
      await client.createIpset(ipset.name, ipset.comment);
      changes.ipsetsCreated += 1;
    } else if (!sameText(target.comment, ipset.comment)) {
      await client.updateIpset(ipset.name, ipset.comment);
      changes.ipsetsUpdated += 1;
    }

    const entries = await client.listIpsetEntries(ipset.name);
    const targetEntries = new Map(entries.map((entry) => [entry.cidr, entry]));
    for (const entry of ipset.entries) {
      const current = targetEntries.get(entry.cidr);
      if (!current) {
        await client.addIpsetEntry(ipset.name, entry.cidr, entry.comment, entry.nomatch);
        changes.entriesAdded += 1;
      } else if (!sameText(current.comment, entry.comment) || (current.nomatch ?? 0) !== (entry.nomatch ?? 0)) {
        await client.deleteIpsetEntry(ipset.name, entry.cidr);
        await client.addIpsetEntry(ipset.name, entry.cidr, entry.comment, entry.nomatch);
        changes.entriesUpdated += 1;
      }
    }
    if (mode === "mirror") {
      const sourceCidrs = new Set(ipset.entries.map((entry) => entry.cidr));
      for (const entry of entries) {
        if (!sourceCidrs.has(entry.cidr)) {
          await client.deleteIpsetEntry(ipset.name, entry.cidr);
          changes.entriesRemoved += 1;
        }
      }
    }
  }

  const targetGroups = await client.listGroups();
  const targetGroupMap = new Map(targetGroups.map((group) => [group.group, group]));
  for (const group of snapshot.groups) {
    const target = targetGroupMap.get(group.name);
    if (!target) {
      await client.createGroup(group.name, group.comment);
      changes.groupsCreated += 1;
    } else if (!sameText(target.comment, group.comment)) {
      await client.updateGroup(group.name, group.comment);
      changes.groupsUpdated += 1;
    }
    await syncRules(client, group, mode, changes);
  }

  if (mode === "mirror" && !selectedGroup) {
    // Delete referencing groups before the IPSets/aliases they can reference.
    const sourceGroups = new Set(snapshot.groups.map((group) => group.name));
    for (const group of targetGroups) {
      if (!sourceGroups.has(group.group)) {
        await client.deleteGroup(group.group);
        changes.objectsRemoved += 1;
      }
    }
    const sourceIpsets = new Set(snapshot.ipsets.map((ipset) => ipset.name));
    for (const ipset of targetIpsets) {
      if (!sourceIpsets.has(ipset.name)) {
        await client.deleteIpset(ipset.name);
        changes.objectsRemoved += 1;
      }
    }
    const sourceAliases = new Set(snapshot.aliases.map((alias) => alias.name));
    for (const alias of targetAliases) {
      if (!sourceAliases.has(alias.name)) {
        await client.deleteAlias(alias.name);
        changes.objectsRemoved += 1;
      }
    }
  }

  return changes;
}

const MAX_RETRIES = 3;

const SUBGRAPHS: Record<number, string> = {
  8453: "https://api.studio.thegraph.com/query/65299/unlock-protocol-base/version/latest",
  137: "https://api.studio.thegraph.com/query/65299/unlock-protocol-polygon/version/latest",
  10: "https://api.studio.thegraph.com/query/65299/unlock-protocol-optimism/version/latest",
  1: "https://api.studio.thegraph.com/query/65299/unlock-protocol-mainnet/version/latest",
  42161: "https://api.studio.thegraph.com/query/65299/unlock-protocol-arbitrum/version/latest",
  56: "https://api.studio.thegraph.com/query/65299/unlock-protocol-bsc/version/latest",
};

interface SubgraphKey {
  id: string;
  owner: string;
  tokenId: string;
  expiration: string;
}

async function querySubgraph(
  url: string,
  query: string,
  retries = MAX_RETRIES
): Promise<Record<string, unknown>> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "PizzaDAO-Unlock-Claim/1.0",
        },
        body: JSON.stringify({ query }),
      });

      if (res.status === 200) {
        const parsed = await res.json();
        if (parsed.errors) {
          throw new Error(JSON.stringify(parsed.errors));
        }
        return parsed.data;
      }

      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
        continue;
      }

      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error("querySubgraph: exhausted retries");
}

export interface TicketInfo {
  lockAddress: string;
  networkId: number;
  eventName: string;
  tokenId: string;
  owner: string;
}

export async function checkWalletForLock(
  walletAddress: string,
  lockAddress: string,
  networkId: number
): Promise<SubgraphKey[]> {
  const subgraphUrl = SUBGRAPHS[networkId];
  if (!subgraphUrl) return [];

  const query = `{
    keys(
      where: {
        lock: "${lockAddress.toLowerCase()}",
        owner: "${walletAddress.toLowerCase()}"
      }
    ) {
      id
      owner
      tokenId
      expiration
    }
  }`;

  try {
    const data = await querySubgraph(subgraphUrl, query);
    return (data.keys as SubgraphKey[]) || [];
  } catch (e) {
    console.error(
      `Error checking lock ${lockAddress} on chain ${networkId}:`,
      e
    );
    return [];
  }
}

export async function findTicketsForWallet(
  walletAddress: string,
  contracts: Array<{
    address: string;
    network_id: number;
    event_name: string;
  }>
): Promise<TicketInfo[]> {
  const tickets: TicketInfo[] = [];

  const byNetwork = new Map<number, typeof contracts>();
  for (const c of contracts) {
    const list = byNetwork.get(c.network_id) || [];
    list.push(c);
    byNetwork.set(c.network_id, list);
  }

  for (const [networkId, networkContracts] of byNetwork) {
    const subgraphUrl = SUBGRAPHS[networkId];
    if (!subgraphUrl) continue;

    const batchSize = 5;
    for (let i = 0; i < networkContracts.length; i += batchSize) {
      const batch = networkContracts.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (contract) => {
          try {
            const keys = await checkWalletForLock(
              walletAddress,
              contract.address,
              networkId
            );
            return keys.map((key) => ({
              lockAddress: contract.address,
              networkId,
              eventName: contract.event_name,
              tokenId: key.tokenId,
              owner: key.owner,
            }));
          } catch {
            return [];
          }
        })
      );
      tickets.push(...results.flat());
    }
  }

  return tickets;
}

export { SUBGRAPHS };

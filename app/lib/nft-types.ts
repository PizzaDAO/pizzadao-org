// NFT Types for PizzaDAO NFT Collection Display

export interface NFTContract {
  address: string;
  name: string;
  chain: string;
  order?: number;
}

export interface AlchemyNFT {
  contract: {
    address: string;
    name: string;
    symbol: string;
  };
  tokenId: string;
  tokenType: string;
  name: string;
  description: string;
  image: {
    cachedUrl: string;
    thumbnailUrl: string;
    originalUrl: string;
  };
  raw: {
    metadata: Record<string, unknown>;
  };
}

export interface NFTDisplayItem {
  contractAddress: string;
  contractName: string;
  tokenId: string;
  name: string;
  imageUrl: string;
  thumbnailUrl: string;
  chain: string;
  order?: number;
  metadata?: Record<string, unknown>;
}

export interface NFTCollectionResponse {
  nfts: NFTDisplayItem[];
  totalCount: number;
  walletAddress: string | null;
  noWallet?: boolean;
  error?: string;
}

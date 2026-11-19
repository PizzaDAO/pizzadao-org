// app/ui/wallet-manager/WalletManager.test.tsx
//
// Regression coverage for the wallet re-add bug: deleting the wallet that is
// currently connected via wagmi/RainbowKit must not have the autoSave effect
// immediately POST it right back (the connected address is still "in
// wagmi", it's just no longer in the saved `wallets` list after delete).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const CONNECTED_ADDRESS = "0x1234567890123456789012345678901234567890";

const useAccountMock = vi.fn();
const useDisconnectMock = vi.fn();
const disconnectAsyncMock = vi.fn();
const useConnectModalMock = vi.fn();
const signMessageAsyncMock = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
  useDisconnect: () => useDisconnectMock(),
  useSignMessage: () => ({ signMessageAsync: signMessageAsyncMock }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => useConnectModalMock(),
  ConnectButton: {
    Custom: ({ children }: { children: (args: { openConnectModal: () => void }) => React.ReactNode }) =>
      children({ openConnectModal: vi.fn() }),
  },
}));

import { WalletManager } from "./WalletManager";

function walletRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    memberId: "member-1",
    walletAddress: CONNECTED_ADDRESS,
    label: null,
    chainType: "evm",
    isPrimary: false,
    source: "wagmi",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("WalletManager — delete the connected wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disconnectAsyncMock.mockResolvedValue(undefined);
    useDisconnectMock.mockReturnValue({ disconnectAsync: disconnectAsyncMock });
    useConnectModalMock.mockReturnValue({ openConnectModal: vi.fn() });
    useAccountMock.mockReturnValue({
      address: CONNECTED_ADDRESS,
      isConnected: true,
    });
  });

  it("does not re-POST the connected address after deleting it", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    // Initial GET: the connected wallet is already saved.
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      if (method === "GET") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ wallets: [walletRow()] }),
        });
      }
      if (method === "DELETE") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ wallets: [] }),
        });
      }
      // Any POST here is the bug: re-adding the address we just deleted.
      return Promise.resolve({
        ok: true,
        json: async () => ({ reward: 0 }),
      });
    });

    render(<WalletManager memberId="member-1" />);

    // Wait for the initial wallet list to load and render.
    await waitFor(() => {
      expect(screen.getByText(/already linked/i)).toBeInTheDocument();
    });

    // Delete the connected wallet: click "Remove wallet", then confirm "Yes".
    fireEvent.click(screen.getByTitle("Remove wallet"));
    fireEvent.click(screen.getByText("Yes"));

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCalls.length).toBe(1);
    });

    // Give the autoSave effect a chance to (incorrectly) re-fire.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const postCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCalls.length).toBe(0);

    // Also disconnects, so the UI stops claiming a "connected" wallet that
    // isn't actually linked to this member any more.
    expect(disconnectAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("shows a warning banner telling the user to disconnect manually if disconnectAsync fails", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    disconnectAsyncMock.mockRejectedValue(new Error("user rejected"));

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      if (method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ wallets: [walletRow()] }) });
      }
      if (method === "DELETE") {
        return Promise.resolve({ ok: true, json: async () => ({ wallets: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ reward: 0 }) });
    });

    render(<WalletManager memberId="member-1" />);

    await waitFor(() => {
      expect(screen.getByText(/already linked/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Remove wallet"));
    fireEvent.click(screen.getByText("Yes"));

    await waitFor(() => {
      expect(disconnectAsyncMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          /still connected.*disconnect it in your wallet/i,
        ),
      ).toBeInTheDocument();
    });
  });

  it("does not disconnect or touch the autoSave guard when deleting a different wallet", async () => {
    const OTHER_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      if (method === "GET") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            wallets: [walletRow(), walletRow({ id: 2, walletAddress: OTHER_ADDRESS })],
          }),
        });
      }
      if (method === "DELETE") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ wallets: [walletRow()] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ reward: 0 }) });
    });

    render(<WalletManager memberId="member-1" />);

    await waitFor(() => {
      expect(screen.getByText(/already linked/i)).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByTitle("Remove wallet");
    // Delete the second (non-connected) wallet row.
    fireEvent.click(removeButtons[1]);
    fireEvent.click(screen.getByText("Yes"));

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCalls.length).toBe(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(disconnectAsyncMock).not.toHaveBeenCalled();
    const postCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCalls.length).toBe(0);
  });

  it("saves the address again after disconnect -> reconnect with the same address", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let currentWallets: unknown[] = [walletRow()];

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      if (method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ wallets: currentWallets }) });
      }
      if (method === "DELETE") {
        currentWallets = [];
        return Promise.resolve({ ok: true, json: async () => ({ wallets: currentWallets }) });
      }
      if (method === "POST") {
        currentWallets = [walletRow()];
        return Promise.resolve({ ok: true, json: async () => ({ wallet: walletRow() }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { rerender } = render(<WalletManager memberId="member-1" />);

    await waitFor(() => {
      expect(screen.getByText(/already linked/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Remove wallet"));
    fireEvent.click(screen.getByText("Yes"));

    await waitFor(() => {
      expect(disconnectAsyncMock).toHaveBeenCalledTimes(1);
    });

    // Simulate wagmi reporting the disconnect, then a fresh reconnect to the
    // same address — the `[isConnected]` effect resets handledAddressRef on
    // the disconnect, so this reconnect should save the address again.
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false });
    rerender(<WalletManager memberId="member-1" />);

    await waitFor(() => {
      expect(screen.getByText(/No wallets connected yet/i)).toBeInTheDocument();
    });

    useAccountMock.mockReturnValue({
      address: CONNECTED_ADDRESS,
      isConnected: true,
    });
    rerender(<WalletManager memberId="member-1" />);

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCalls.length).toBe(1);
    });
  });
});

describe("WalletManager - failed load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDisconnectMock.mockReturnValue({ disconnectAsync: disconnectAsyncMock });
    useConnectModalMock.mockReturnValue({ openConnectModal: vi.fn() });
    useAccountMock.mockReturnValue({ address: CONNECTED_ADDRESS, isConnected: true });
  });

  it("shows a retry state instead of 'No wallets' and does not auto-save", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method || "GET") === "GET") {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<WalletManager memberId="member-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Couldn.t load your wallets/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/No wallets connected yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(
      (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(posts.length).toBe(0);
  });
});

describe("WalletManager — wallet ownership signature", () => {
  const NONCE = "a".repeat(60);

  function mockApi(required: boolean) {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      if (url.startsWith("/api/wallet/nonce")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ nonce: NONCE, required, statement: "Link this wallet to PizzaDAO member member-1. This is free and sends no transaction." }),
        });
      }
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ wallets: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    return fetchMock;
  }

  const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter((c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "POST");

  beforeEach(() => {
    vi.clearAllMocks();
    useDisconnectMock.mockReturnValue({ disconnectAsync: disconnectAsyncMock });
    useConnectModalMock.mockReturnValue({ openConnectModal: vi.fn() });
    useAccountMock.mockReturnValue({ address: CONNECTED_ADDRESS, isConnected: true, chainId: 1 });
  });

  it("signs a SIWE message and POSTs it when a signature is required", async () => {
    const fetchMock = mockApi(true);
    signMessageAsyncMock.mockResolvedValue("0xsig");
    render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(posts(fetchMock).length).toBe(1));
    const body = JSON.parse((posts(fetchMock)[0][1] as RequestInit).body as string);
    expect(body.signature).toBe("0xsig");
    expect(body.message).toContain(`Nonce: ${NONCE}`);
    expect(body.message).toContain(CONNECTED_ADDRESS);
    expect(signMessageAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("does not save when the member declines to sign", async () => {
    const fetchMock = mockApi(true);
    signMessageAsyncMock.mockRejectedValue(Object.assign(new Error("User rejected the request"), { code: 4001 }));
    render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(screen.getByText(/Signature declined/i)).toBeInTheDocument());
    expect(posts(fetchMock).length).toBe(0);
  });

  it("skips signing when the server does not require it", async () => {
    const fetchMock = mockApi(false);
    render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(posts(fetchMock).length).toBe(1));
    expect(signMessageAsyncMock).not.toHaveBeenCalled();
    const body = JSON.parse((posts(fetchMock)[0][1] as RequestInit).body as string);
    expect(body.signature).toBeUndefined();
  });

  it("falls back to the plain POST when the nonce call fails, and lets the server decide", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      if (url.startsWith("/api/wallet/nonce")) return Promise.resolve({ ok: false, json: async () => ({}) });
      if (method === "GET") return Promise.resolve({ ok: true, json: async () => ({ wallets: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(posts(fetchMock).length).toBe(1));
    expect(signMessageAsyncMock).not.toHaveBeenCalled();
    const body = JSON.parse((posts(fetchMock)[0][1] as RequestInit).body as string);
    expect(body.signature).toBeUndefined();
  });

  it("shows the signing copy only while a signature is requested", async () => {
    mockApi(false);
    render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(posts(global.fetch as unknown as ReturnType<typeof vi.fn>).length).toBe(1));
    expect(screen.queryByText(/Sign a free message/i)).toBeNull();

    vi.clearAllMocks();
    useAccountMock.mockReturnValue({ address: CONNECTED_ADDRESS, isConnected: true, chainId: 1 });
    mockApi(true);
    let release: (v: string) => void = () => undefined;
    signMessageAsyncMock.mockReturnValue(new Promise<string>((r) => (release = r)));
    render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(screen.getByText(/Sign a free message to prove this wallet is yours \(no gas\)/i)).toBeInTheDocument());
    release("0xsig");
  });

  it("offers EVM paste while a signature is not required, and only Solana when it is", async () => {
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false });
    mockApi(false);
    const { unmount } = render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(screen.getByText("Add Manually")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add Manually"));
    expect(screen.getByText("EVM (Ethereum)")).toBeInTheDocument();
    unmount();

    mockApi(true);
    render(<WalletManager memberId="member-1" />);
    await waitFor(() => expect(screen.getByText("Add Solana Manually")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add Solana Manually"));
    expect(screen.queryByText("EVM (Ethereum)")).toBeNull();
  });
});

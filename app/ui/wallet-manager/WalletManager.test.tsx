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

vi.mock("wagmi", () => ({
  useAccount: () => useAccountMock(),
  useDisconnect: () => useDisconnectMock(),
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

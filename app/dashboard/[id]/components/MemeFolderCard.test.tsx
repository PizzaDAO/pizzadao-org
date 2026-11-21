import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));

import { MemeFolderCard } from "./MemeFolderCard";

afterEach(cleanup);

describe("MemeFolderCard", () => {
    it("renders nothing while the feature is off", () => {
        const { container } = renderWithIntl(<MemeFolderCard initial={{ enabled: false }} />);
        expect(container.querySelector('[data-testid="meme-folder-card"]')).toBeNull();
    });

    it("shows recent thumbnails and the folder link when on", () => {
        renderWithIntl(
            <MemeFolderCard initial={{ enabled: true, items: [{ id: "a", url: "https://x.public.blob.vercel-storage.com/memes/a.png", caption: "hi" }], meta: { canUpload: true, reviewer: false, pending: null } }} />,
        );
        expect(screen.getByTestId("meme-folder-card")).toBeTruthy();
        expect(screen.getByRole("link", { name: "Open folder" }).getAttribute("href")).toBe("/memes");
        expect(screen.queryByText(/waiting for review/)).toBeNull();
    });

    it("shows the waiting count to reviewers only", () => {
        renderWithIntl(<MemeFolderCard initial={{ enabled: true, items: [], meta: { canUpload: true, reviewer: true, pending: 2 } }} />);
        expect(screen.getByText("2 memes waiting for review").getAttribute("href")).toBe("/memes/review");
    });

    it("renders in Spanish", () => {
        renderWithIntl(<MemeFolderCard initial={{ enabled: true, items: [] }} />, { locale: "es" });
        expect(screen.getByText("Abrir carpeta")).toBeTruthy();
    });
});

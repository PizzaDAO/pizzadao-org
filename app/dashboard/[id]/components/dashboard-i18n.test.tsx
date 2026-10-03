// app/dashboard/[id]/components/dashboard-i18n.test.tsx
//
// Renders the dashboard sections with the Spanish (and a French spot-check)
// catalog to make sure copy, ICU plurals and locale-aware numbers/dates come
// through — not the English fallbacks or raw message keys.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, act, cleanup } from "@testing-library/react";
import { renderWithIntl } from "@/app/lib/i18n/test-utils";

vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));
// Chrome controls in the hero pull in react-query / theme state — not under test.
vi.mock("../../../ui/notifications", () => ({ NotificationBell: () => null }));
vi.mock("../../../ui/ThemeToggle", () => ({ ThemeToggle: () => null }));

import { Discover } from "./Discover";
import { HeroBlock } from "./HeroBlock";
import { NextActionPanel } from "./NextActionPanel";
import { ProfileCompletionMeter } from "./ProfileCompletionMeter";
import { RecentActivity } from "./RecentActivity";
import { YourCrews } from "./YourCrews";
import { getProfileCompletion } from "../lib/profile-completion";
import { resolveNextAction, type NextActionInput } from "../lib/next-action";
import { MissionsProgress } from "../../../ui/missions/MissionsProgress";
import { LevelUpModal } from "../../../ui/missions/LevelUpModal";
import { MissionCompleteCelebration } from "../../../ui/missions/MissionCompleteCelebration";
import { ProfileCompleteCelebration } from "../../../ui/profile/ProfileCompleteCelebration";

afterEach(cleanup);

const ES = { locale: "es" as const };
const FR = { locale: "fr" as const };

function nextActionInput(overrides: Partial<NextActionInput> = {}): NextActionInput {
    return {
        member: { id: "42", crews: ["tech"] },
        level: {
            current: 2,
            title: null,
            completedThisLevel: 0,
            totalThisLevel: 3,
            nextMission: { id: 14, title: "Post your first vouch" },
            awaitingReview: false,
        },
        vouches: { total: 0 },
        wallets: { count: 1 },
        x: { connected: true },
        notifications: { unread: 0, top: null },
        ...overrides,
    };
}

describe("dashboard in Spanish", () => {
    it("ProfileCompletionMeter uses the ICU plural + translated step labels", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: ["tech"] },
            wallets: { count: 0 },
            x: { connected: false },
        });
        renderWithIntl(<ProfileCompletionMeter completion={completion} />, ES);
        expect(screen.getByText(/1 de 3 lista/)).toBeInTheDocument();
        expect(screen.getByText("§ configuración del perfil")).toBeInTheDocument();
        const bar = screen.getByRole("progressbar", { name: "Configuración del perfil" });
        expect(bar.getAttribute("aria-valuetext")).toBe("1 de 3 pasos completados");
        expect(screen.getByRole("link", { name: /Siguiente: Conecta una wallet/ })).toBeInTheDocument();
    });

    it("ProfileCompletionMeter pluralizes for 2 done", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: ["tech"] },
            wallets: { count: 1 },
            x: { connected: false },
        });
        renderWithIntl(<ProfileCompletionMeter completion={completion} />, ES);
        expect(screen.getByText(/2 de 3 listas/)).toBeInTheDocument();
    });

    it("HeroBlock translates CTAs, badge and formats PEP with the es locale", () => {
        renderWithIntl(
            <HeroBlock
                name="Pepperoni Corleone"
                pfpUrl={null}
                levelBadge={{ level: 3, title: "Capo" }}
                pepBalance={12345}
                city="Madrid"
                idValue="42"
                onSendPep={() => {}}
            />,
            ES,
        );
        expect(screen.getByText("§ 01 · el expediente")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Editar perfil/ })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Gestionar wallets/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Enviar PEP" })).toBeInTheDocument();
        expect(screen.getByText(/Nv\.3/)).toBeInTheDocument();
        expect(screen.getByText("12.345")).toBeInTheDocument();
    });

    it("NextActionPanel re-renders the server action in Spanish", () => {
        const action = resolveNextAction(nextActionInput());
        renderWithIntl(<NextActionPanel nextAction={action} />, ES);
        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
            "Tu próxima misión está lista",
        );
        // Mission title is data and stays as-is.
        expect(screen.getByText("Post your first vouch")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Enviar misión de nivel 2/ })).toHaveAttribute(
            "href",
            "/missions#mission-14",
        );
        expect(screen.getByRole("button", { name: "Posponer la próxima acción" })).toHaveTextContent(
            "Ahora no",
        );
    });

    it("NextActionPanel translates profile-step actions", () => {
        const action = resolveNextAction(
            nextActionInput({ member: { id: "42", crews: [] } }),
        );
        renderWithIntl(<NextActionPanel nextAction={action} />, ES);
        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
            "Bienvenido — elige una crew para empezar",
        );
        expect(screen.getByRole("link", { name: /Únete a tu primera crew/ })).toHaveAttribute(
            "href",
            "/crews",
        );
    });

    it("Discover translates tabs, statuses, empty states and formats rewards/dates", () => {
        renderWithIntl(
            <Discover
                bounties={[
                    { id: 1, description: "Diseña un flyer", reward: 12000, status: "OPEN" },
                    { id: 2, description: "Traduce el FAQ", reward: 69, status: "CLAIMED" },
                ]}
                jobs={[]}
                articles={[]}
                calls={[{ crewId: "ops", crewLabel: "Ops", date: "2026-05-20" }]}
            />,
            ES,
        );
        expect(screen.getByText("Lo que hay en el tablón")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Recompensas/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByText("Abierta")).toBeInTheDocument();
        expect(screen.getByText("Reclamada")).toBeInTheDocument();
        expect(screen.getByText("12.000 PEP")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Ver todo/ })).toBeInTheDocument();

        act(() => {
            fireEvent.click(screen.getByRole("tab", { name: /Trabajos/ }));
        });
        expect(screen.getByText(/Hoy no hay trabajos disponibles/)).toBeInTheDocument();

        act(() => {
            fireEvent.click(screen.getByRole("tab", { name: /Llamadas/ }));
        });
        // 2026-05-20 is a Wednesday ("mié") — formatted in UTC with the es locale.
        const call = screen.getByRole("link", { name: /^Llamada: Ops el / });
        expect(call.textContent).toMatch(/mié/);
        expect(call.textContent).toMatch(/20/);
        expect(call.textContent).toMatch(/may/);
    });

    it("RecentActivity shows Spanish headings and relative times", () => {
        const now = Date.now();
        renderWithIntl(
            <RecentActivity
                events={[
                    {
                        id: "a",
                        kind: "vouch_received",
                        title: "Vouch from Basil",
                        href: null,
                        at: new Date(now - 5 * 60_000).toISOString(),
                    },
                    {
                        id: "b",
                        kind: "mission_approved",
                        title: "Mission approved",
                        href: null,
                        at: new Date(now - 3 * 86_400_000).toISOString(),
                    },
                ]}
            />,
            ES,
        );
        expect(screen.getByText("Lo que cambió mientras no estabas")).toBeInTheDocument();
        expect(screen.getByText("hace 5 min")).toBeInTheDocument();
        expect(screen.getByText("hace 3 días")).toBeInTheDocument();
    });

    it("RecentActivity empty state", () => {
        renderWithIntl(<RecentActivity events={[]} />, ES);
        expect(screen.getByText("— todo tranquilo —")).toBeInTheDocument();
    });

    it("YourCrews translates headings, links and the closed-count plural", () => {
        renderWithIntl(
            <YourCrews
                crewOptions={[{ id: "tech", label: "Tech", tasks: [{ label: "Fix the oven" }] }]}
                userCrews={["tech"]}
                myTasks={{}}
                doneCounts={{ tech: 1 }}
            />,
            ES,
        );
        expect(screen.getByText("Las familias con las que andas")).toBeInTheDocument();
        expect(screen.getByText("1 cerrada")).toBeInTheDocument();
        expect(screen.getByText("§ tareas destacadas")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Abrir crew/ })).toHaveAttribute("href", "/crew/tech");
    });

    it("MissionsProgress translates labels", () => {
        renderWithIntl(
            <MissionsProgress
                summary={{
                    isAuthenticated: true,
                    currentLevel: 1,
                    levelTitle: "Pizza Noob",
                    levels: [
                        {
                            level: 1,
                            title: "Pizza Noob",
                            reward: 25000,
                            missions: [
                                { id: 1, title: "Say hi", progress: { status: "APPROVED" } },
                                { id: 2, title: "Join a call", progress: null },
                            ],
                        },
                    ],
                }}
            />,
            ES,
        );
        expect(screen.getByText("Misiones")).toBeInTheDocument();
        expect(screen.getByText("1/2 en el expediente")).toBeInTheDocument();
        expect(screen.getByText("+25.000 $PEP")).toBeInTheDocument();
        expect(screen.getByText("§ Total · 1/2 cerradas")).toBeInTheDocument();
    });

    it("celebration modals render in Spanish", () => {
        renderWithIntl(
            <ProfileCompleteCelebration stepLabels={["Únete a una crew"]} onDismiss={() => {}} />,
            ES,
        );
        expect(screen.getByRole("dialog", { name: "¡Ya estás listo!" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "¡Genial!" })).toBeInTheDocument();
        cleanup();

        renderWithIntl(<MissionCompleteCelebration onDismiss={() => {}} autoDismissMs={0} />, ES);
        expect(screen.getByText("¡Misión cumplida!")).toBeInTheDocument();
        cleanup();

        renderWithIntl(
            <LevelUpModal level={2} levelTitle="Pizza Noob" reward={13370} onDismiss={() => {}} />,
            ES,
        );
        expect(screen.getByRole("dialog", { name: "Alcanzaste el nivel 2" })).toBeInTheDocument();
        expect(screen.getByText("Nivel 2")).toBeInTheDocument();
        expect(screen.getByText("+13.370 $PEP ganados")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
    });
});

describe("dashboard in French (spot check)", () => {
    it("ProfileCompletionMeter pluralizes in French", () => {
        const completion = getProfileCompletion({
            member: { id: "42", crews: ["tech"] },
            wallets: { count: 1 },
            x: { connected: false },
        });
        renderWithIntl(<ProfileCompletionMeter completion={completion} />, FR);
        expect(screen.getByText(/2 sur 3 terminées/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Suivant : Connecter X/ })).toBeInTheDocument();
    });

    it("LevelUpModal formats the reward with French grouping", () => {
        renderWithIntl(
            <LevelUpModal level={8} levelTitle={null} reward={13370} onDismiss={() => {}} />,
            FR,
        );
        expect(screen.getByText("§ Niveau final atteint")).toBeInTheDocument();
        // fr-FR groups with a narrow no-break space (U+202F).
        expect(screen.getByText(/^\+13\s370 \$PEP gagnés$/u)).toBeInTheDocument();
    });
});

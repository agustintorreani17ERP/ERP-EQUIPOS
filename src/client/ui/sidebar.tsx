/**
 * Sidebar al estilo shadcn/ui (https://ui.shadcn.com/docs/components/base/sidebar), reimplementado
 * sin Radix (el proyecto no lo usa): mismo API — Provider, colapso a modo ícono, rail para
 * expandir/contraer, versión mobile en cajón — pero con Tailwind puro y sin fondos de color
 * (texto negro, acento neutro; ver CLAUDE.md).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PanelLeft } from "lucide-react";
import { cx } from "./index";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3.5rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_STORAGE_KEY = "taller_sidebar_state";
const MOBILE_BREAKPOINT = 768;

type SidebarState = "expanded" | "collapsed";

interface SidebarContextValue {
  state: SidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar debe usarse dentro de <SidebarProvider>");
  return ctx;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT));
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export function SidebarProvider({
  defaultOpen = true,
  className,
  children,
}: {
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);
  const [open, setOpenState] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved !== null) return saved === "true";
    } catch {}
    return defaultOpen;
  });

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(value));
    } catch {}
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isMobile) setOpenMobile((v) => !v);
    else setOpen(!open);
  }, [isMobile, open, setOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const state: SidebarState = open ? "expanded" : "collapsed";

  const value = useMemo<SidebarContextValue>(
    () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar]
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        className={cx("flex h-screen w-full overflow-hidden", className)}
        style={{ ["--sidebar-width" as any]: SIDEBAR_WIDTH, ["--sidebar-width-icon" as any]: SIDEBAR_WIDTH_ICON }}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <>
        {openMobile && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="fixed inset-0 bg-slate-900/40" onClick={() => setOpenMobile(false)} />
            <aside
              className={cx("relative z-10 flex h-full flex-col border-r border-slate-200 bg-white", className)}
              style={{ width: SIDEBAR_WIDTH_MOBILE }}
            >
              {children}
            </aside>
          </div>
        )}
      </>
    );
  }

  return (
    <aside
      data-state={state}
      className={cx(
        "relative hidden h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ease-linear md:flex",
        className
      )}
      style={{ width: state === "expanded" ? SIDEBAR_WIDTH : SIDEBAR_WIDTH_ICON }}
    >
      {children}
    </aside>
  );
}

/** Franja pegada al borde derecho del sidebar (toda la altura): un clic lo expande o contrae (solo desktop). */
export function SidebarRail() {
  const { toggleSidebar, isMobile } = useSidebar();
  if (isMobile) return null;
  return (
    <button
      onClick={toggleSidebar}
      title="Expandir / contraer menú"
      aria-label="Expandir o contraer el menú"
      className="absolute inset-y-0 -right-2 hidden w-4 cursor-col-resize md:block"
    >
      <span className="mx-auto block h-full w-px bg-transparent transition hover:bg-slate-300" />
    </button>
  );
}

export function SidebarTrigger({ className }: { className?: string }) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      onClick={toggleSidebar}
      className={cx("rounded-lg p-1.5 text-slate-600 hover:bg-slate-100", className)}
      aria-label="Alternar menú"
    >
      <PanelLeft className="h-4.5 w-4.5" />
    </button>
  );
}

export function SidebarInset({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("flex min-w-0 flex-1 flex-col overflow-hidden", className)}>{children}</div>;
}

export function SidebarHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("flex h-14 shrink-0 items-center gap-2.5 border-b border-slate-100 px-3", className)}>{children}</div>;
}

export function SidebarFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("shrink-0 space-y-1 border-t border-slate-100 p-2", className)}>{children}</div>;
}

export function SidebarContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2 py-3", className)}>{children}</div>;
}

export function SidebarGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("space-y-0.5", className)}>{children}</div>;
}

export function SidebarGroupLabel({ children, title }: { children: React.ReactNode; title?: string }) {
  const { state } = useSidebar();
  return (
    <p
      title={title}
      className={cx(
        "truncate px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 transition-opacity",
        state === "collapsed" && "pointer-events-none h-0 overflow-hidden opacity-0"
      )}
    >
      {children}
    </p>
  );
}

export function SidebarMenu({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-0.5">{children}</ul>;
}

export function SidebarMenuItem({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  tooltip?: string;
  icon?: React.ElementType;
  badge?: React.ReactNode;
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ isActive, tooltip, icon: Icon, badge, className, children, ...props }, ref) => {
    const { state, isMobile } = useSidebar();
    const collapsed = state === "collapsed" && !isMobile;
    return (
      <button
        ref={ref}
        title={collapsed ? tooltip : undefined}
        aria-current={isActive ? "page" : undefined}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
          collapsed && "justify-center px-0",
          isActive ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
          className
        )}
        {...props}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className={cx("min-w-0 flex-1 truncate text-left", collapsed && "sr-only")}>{children}</span>
        {badge && !collapsed && badge}
      </button>
    );
  }
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export function SidebarMenuBadge({ children }: { children: React.ReactNode }) {
  const { state, isMobile } = useSidebar();
  if (state === "collapsed" && !isMobile) return null;
  return <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700">{children}</span>;
}

export function SidebarSeparator() {
  return <hr className="my-2 border-slate-100" />;
}

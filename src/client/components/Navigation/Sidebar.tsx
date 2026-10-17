/**
 * Menú lateral de Taller (mismo formato que InfraTrack): marca, grupos y pie.
 */
import React from "react";
import { Boxes, ClipboardList, Clock, Fuel, LayoutDashboard, Send, Truck, Upload, Users, Wallet, Wrench } from "lucide-react";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "../../ui/sidebar";

export type AppModule = "DASHBOARD" | "MACHINES" | "DAILY_REPORTS" | "SERVICES" | "FUEL" | "ORDERS" | "STOCK" | "DISPATCH" | "FINANCE" | "SUPPLIERS" | "IMPORT";

const GROUPS: { title: string; items: { id: AppModule; label: string; icon: React.ElementType }[] }[] = [
  {
    title: "Operación",
    items: [
      { id: "DASHBOARD", label: "Panel", icon: LayoutDashboard },
      { id: "MACHINES", label: "Flota", icon: Truck },
      { id: "DAILY_REPORTS", label: "Partes diarios", icon: Clock },
      { id: "SERVICES", label: "Mantenimiento", icon: Wrench },
      { id: "FUEL", label: "Combustibles", icon: Fuel },
    ],
  },
  {
    title: "Abastecimiento",
    items: [
      { id: "ORDERS", label: "Pedidos", icon: ClipboardList },
      { id: "STOCK", label: "Stock", icon: Boxes },
      { id: "DISPATCH", label: "Notas de envío", icon: Send },
    ],
  },
  {
    title: "Administración",
    items: [
      { id: "FINANCE", label: "Fondos", icon: Wallet },
      { id: "SUPPLIERS", label: "Proveedores", icon: Users },
      { id: "IMPORT", label: "Importar planillas", icon: Upload },
    ],
  },
];

interface SidebarProps {
  currentModule: AppModule;
  onSelectModule: (module: AppModule) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentModule, onSelectModule }) => (
  <SidebarRoot>
    <SidebarHeader>
      <BrandMark />
    </SidebarHeader>

    <SidebarContent>
      {GROUPS.map((group) => (
        <React.Fragment key={group.title}>
          <SidebarGroup>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map(({ id, label, icon }) => (
                <React.Fragment key={id}>
                  <SidebarMenuItem>
                    <NavButton icon={icon} isActive={currentModule === id} tooltip={label} onClick={() => onSelectModule(id)}>
                      {label}
                    </NavButton>
                  </SidebarMenuItem>
                </React.Fragment>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </React.Fragment>
      ))}
    </SidebarContent>

    <SidebarRail />
  </SidebarRoot>
);

/** Botón de navegación: en mobile, cierra el cajón del menú al elegir un destino. */
function NavButton({ onClick, ...props }: React.ComponentProps<typeof SidebarMenuButton>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (isMobile) setOpenMobile(false);
      }}
    />
  );
}

function BrandMark() {
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  return (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
        <Wrench className="h-4 w-4" />
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-slate-900">Taller</p>
          <p className="truncate text-[11px] text-slate-500">Flota y mantenimiento</p>
        </div>
      )}
    </>
  );
}

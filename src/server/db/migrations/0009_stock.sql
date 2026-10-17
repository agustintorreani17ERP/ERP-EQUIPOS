-- 0009_stock: artículos y vales de stock del taller. Reemplaza STOCK TALLER CREAR ITEM y STOCK TALLER
-- ENTRADA Y SALIDA del Access, donde las cantidades eran texto y el saldo solo existía en un informe.
-- El saldo y el valor de cada artículo se calculan de los renglones de los vales vigentes; el valor
-- sale del costo promedio ponderado (cada renglón guarda el valor con el signo de su efecto sobre el saldo).
-- Idempotente. Todas las tablas tienen RLS por empresa.

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  -- Código comparable: mayúsculas y sin espacios, guiones, puntos ni barras.
  codigo_norm text not null,
  descripcion text not null,
  rubro text not null default 'REPUESTOS' check (rubro in ('FILTROS', 'ACEITES', 'BATERIAS', 'CUBIERTAS', 'REPUESTOS', 'OTROS')),
  unidad text not null default 'U' check (unidad in ('U', 'L', 'KG', 'M', 'JUEGO')),
  stock_minimo numeric(14,3) not null default 0 check (stock_minimo >= 0),
  ubicacion text,
  equivalencias jsonb not null default '[]'::jsonb,
  aplicacion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, codigo_norm)
);

create index if not exists articles_company_rubro on articles (company_id, rubro);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  fecha date not null,
  tipo text not null check (tipo in ('ENTRADA', 'SALIDA', 'SALDO_INICIAL', 'AJUSTE')),
  -- Destino de una salida.
  machine_id uuid references machines(id),
  worksite_id uuid references worksites(id),
  service_order_id uuid references service_orders(id),
  -- Origen de una entrada.
  supplier_id uuid references suppliers(id),
  remision text,
  reception_id uuid references order_receptions(id),
  motivo text,
  observaciones text,
  anulado boolean not null default false,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  unique (company_id, numero),
  check (tipo = 'SALIDA' or (machine_id is null and worksite_id is null and service_order_id is null)),
  check (tipo = 'ENTRADA' or reception_id is null)
);

create index if not exists stock_movements_company_fecha on stock_movements (company_id, fecha);
create index if not exists stock_movements_company_machine on stock_movements (company_id, machine_id);
create index if not exists stock_movements_company_worksite on stock_movements (company_id, worksite_id);
create index if not exists stock_movements_company_reception on stock_movements (company_id, reception_id);

create table if not exists stock_movement_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  movement_id uuid not null references stock_movements(id) on delete cascade,
  article_id uuid not null references articles(id),
  -- Positiva salvo en un ajuste, que lleva su signo.
  cantidad numeric(14,3) not null check (cantidad <> 0),
  costo_unitario numeric(18,4) not null default 0 check (costo_unitario >= 0),
  -- Variación del valor del artículo, con el mismo signo que su efecto sobre el saldo.
  valor numeric(18,2) not null default 0,
  unique (movement_id, article_id)
);

create index if not exists stock_movement_lines_company_article on stock_movement_lines (company_id, article_id);

alter table articles enable row level security;
alter table stock_movements enable row level security;
alter table stock_movement_lines enable row level security;

drop policy if exists articles_tenant on articles;
create policy articles_tenant on articles
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists stock_movements_tenant on stock_movements;
create policy stock_movements_tenant on stock_movements
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists stock_movement_lines_tenant on stock_movement_lines;
create policy stock_movement_lines_tenant on stock_movement_lines
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

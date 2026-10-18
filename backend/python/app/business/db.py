"""COOS — Business Platform (separate track from the personal-OS).

Database bootstrap for the business-ops schema. Deliberately minimal for now:
a single `biz_clients` table exists purely to prove the tool-bridge pattern
end-to-end with one real entity (Clients). More entities (projects, employees,
finance) come in a later phase.

NOTE: this relies on the `uuid-ossp` extension already being enabled by the
personal-OS `app.db.init.ensure_tables()`, which must run first in the same
lifespan (it does — see main.py).
"""

import structlog

log = structlog.get_logger()


def ensure_business_tables() -> None:
    import psycopg2
    from app.core.config import settings as s

    conn = psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS biz_clients (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name TEXT NOT NULL,
                contact_name TEXT DEFAULT '',
                contact_email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'prospect',
                notes TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_biz_clients_status ON biz_clients(status);
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS biz_projects (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                client_id UUID NOT NULL REFERENCES biz_clients(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'planning',
                start_date DATE DEFAULT NULL,
                due_date DATE DEFAULT NULL,
                notes TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_biz_projects_client ON biz_projects(client_id);
            CREATE INDEX IF NOT EXISTS idx_biz_projects_status ON biz_projects(status);
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS biz_team_members (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name TEXT NOT NULL,
                email TEXT DEFAULT '',
                role TEXT DEFAULT '',
                member_type TEXT NOT NULL DEFAULT 'employee',
                rate FLOAT DEFAULT 0,
                rate_unit TEXT DEFAULT 'hourly',
                status TEXT NOT NULL DEFAULT 'active',
                start_date DATE DEFAULT NULL,
                end_date DATE DEFAULT NULL,
                notes TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_biz_team_status ON biz_team_members(status);
            CREATE INDEX IF NOT EXISTS idx_biz_team_type ON biz_team_members(member_type);

            CREATE TABLE IF NOT EXISTS biz_project_assignments (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                project_id UUID NOT NULL REFERENCES biz_projects(id) ON DELETE CASCADE,
                team_member_id UUID NOT NULL REFERENCES biz_team_members(id) ON DELETE CASCADE,
                role_on_project TEXT DEFAULT '',
                assigned_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(project_id, team_member_id)
            );
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS biz_invoices (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                client_id UUID NOT NULL REFERENCES biz_clients(id) ON DELETE CASCADE,
                project_id UUID DEFAULT NULL REFERENCES biz_projects(id) ON DELETE SET NULL,
                invoice_number TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                issue_date DATE DEFAULT NULL,
                due_date DATE DEFAULT NULL,
                paid_date DATE DEFAULT NULL,
                notes TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_biz_invoices_client ON biz_invoices(client_id);
            CREATE INDEX IF NOT EXISTS idx_biz_invoices_status ON biz_invoices(status);

            CREATE TABLE IF NOT EXISTS biz_invoice_line_items (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                invoice_id UUID NOT NULL REFERENCES biz_invoices(id) ON DELETE CASCADE,
                description TEXT NOT NULL,
                quantity FLOAT NOT NULL DEFAULT 1,
                unit_price FLOAT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_biz_invoice_items_invoice ON biz_invoice_line_items(invoice_id);

            CREATE TABLE IF NOT EXISTS biz_expenses (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                project_id UUID DEFAULT NULL REFERENCES biz_projects(id) ON DELETE SET NULL,
                description TEXT NOT NULL,
                amount FLOAT NOT NULL DEFAULT 0,
                category TEXT DEFAULT 'other',
                expense_date DATE DEFAULT NULL,
                notes TEXT DEFAULT '',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_biz_expenses_project ON biz_expenses(project_id);
        """)
        conn.commit()
        log.info("business: ensure_business_tables OK")
    finally:
        conn.close()

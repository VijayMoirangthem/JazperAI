"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/swr";
import { Loader2, Plus, Trash2, Receipt } from "lucide-react";

const API = "http://localhost:8000";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
type ExpenseCategory = "software" | "contractor" | "travel" | "office" | "other";

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  title: string;
  client_id: string;
}

interface Invoice {
  id: string;
  client_id: string;
  project_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string | null;
  due_date: string | null;
  notes: string;
  total: number;
}

interface LineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface InvoiceDetail extends Invoice {
  line_items: LineItem[];
}

interface Expense {
  id: string;
  description: string;
  amount: number;
  project_id: string | null;
  category: ExpenseCategory;
  expense_date: string | null;
  notes: string;
}

interface Summary {
  total_invoiced: number;
  total_paid: number;
  total_outstanding: number;
  total_expenses: number;
  invoice_count: number;
}

const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue", "cancelled"];
const EXPENSE_CATEGORIES: ExpenseCategory[] = ["software", "contractor", "travel", "office", "other"];

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function invoiceBadgeClass(status: InvoiceStatus) {
  switch (status) {
    case "paid": return "biz-badge biz-badge-success";
    case "sent": return "biz-badge biz-badge-info";
    case "overdue": return "biz-badge biz-badge-danger";
    default: return "biz-badge biz-badge-neutral";
  }
}

export default function FinancePage() {
  const [summaryClientId, setSummaryClientId] = useState("");
  const [tab, setTab] = useState<"invoices" | "expenses">("invoices");
  const [error, setError] = useState<string | null>(null);

  const { data: clients, refresh: refreshClients, loading: clientsLoading } = useApi<Client[]>(`${API}/api/business/clients`, { ttl: 30000, poll: 30000 });
  const { data: projects, refresh: refreshProjects, loading: projectsLoading } = useApi<Project[]>(`${API}/api/business/projects`, { ttl: 30000, poll: 30000 });
  const { data: summary, refresh: refreshSummary, loading: summaryLoading } = useApi<Summary>(`${API}/api/business/finance/summary${summaryClientId ? `?client_id=${encodeURIComponent(summaryClientId)}` : ""}`, { ttl: 10000, poll: 30000 });
  const { data: invoices, refresh: refreshInvoices, loading: invoicesLoading } = useApi<Invoice[]>(`${API}/api/business/finance/invoices`, { ttl: 10000, poll: 30000 });
  const { data: expenses, refresh: refreshExpenses, loading: expensesLoading } = useApi<Expense[]>(`${API}/api/business/finance/expenses`, { ttl: 10000, poll: 30000 });

  const clientList = clients ?? [];
  const projectList = projects ?? [];
  const invoiceList = invoices ?? [];
  const expenseList = expenses ?? [];

  const clientNameById = (id: string) => clientList.find(c => c.id === id)?.name || "Unknown client";

  async function handleSummaryClientChange(id: string) {
    setSummaryClientId(id);
    await refreshSummary();
  }

  async function refreshAll() {
    await Promise.all([refreshInvoices(), refreshExpenses(), refreshSummary()]);
  }

  return (
    <div className="biz-page">
      <div className="biz-page-header">
        <div>
          <h1 className="biz-page-title">Finance</h1>
          <p className="biz-page-subtitle">Invoices, expenses, and where the money stands.</p>
        </div>
        <select className="biz-select" style={{ width: 220 }} value={summaryClientId} onChange={e => handleSummaryClientChange(e.target.value)}>
          <option value="">All Clients</option>
          {clientList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="biz-card" style={{ marginBottom: 16, borderColor: "var(--biz-danger)", color: "var(--biz-danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="biz-stat-grid">
        <div className="biz-stat">
          <p className="biz-stat-label">Total Invoiced</p>
          <div className="biz-stat-value">{summary ? currency(summary.total_invoiced) : "—"}</div>
        </div>
        <div className="biz-stat">
          <p className="biz-stat-label">Total Paid</p>
          <div className="biz-stat-value">{summary ? currency(summary.total_paid) : "—"}</div>
        </div>
        <div className="biz-stat">
          <p className="biz-stat-label">Outstanding</p>
          <div className="biz-stat-value">{summary ? currency(summary.total_outstanding) : "—"}</div>
        </div>
        <div className="biz-stat">
          <p className="biz-stat-label">Total Expenses</p>
          <div className="biz-stat-value">{summary ? currency(summary.total_expenses) : "—"}</div>
        </div>
        <div className="biz-stat">
          <p className="biz-stat-label">Invoice Count</p>
          <div className="biz-stat-value">{summary ? summary.invoice_count : "—"}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`biz-btn ${tab === "invoices" ? "biz-btn-primary" : "biz-btn-ghost"}`} onClick={() => setTab("invoices")}>Invoices</button>
        <button className={`biz-btn ${tab === "expenses" ? "biz-btn-primary" : "biz-btn-ghost"}`} onClick={() => setTab("expenses")}>Expenses</button>
      </div>

      {(clientsLoading || projectsLoading || summaryLoading || invoicesLoading || expensesLoading) && invoiceList.length === 0 && expenseList.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--biz-text-muted)" }}>
          <Loader2 size={18} className="biz-spin" />
        </div>
      ) : tab === "invoices" ? (
        <InvoicesTab
          clients={clientList}
          projects={projectList}
          invoices={invoiceList}
          clientNameById={clientNameById}
          onMutate={refreshAll}
          setError={setError}
        />
      ) : (
        <ExpensesTab
          projects={projectList}
          expenses={expenseList}
          onMutate={refreshAll}
          setError={setError}
        />
      )}
    </div>
  );
}

/* ── Invoices tab ──────────────────────────────────────────────────────── */

interface InvoiceFormState {
  client_id: string;
  invoice_number: string;
  project_id: string;
  issue_date: string;
  due_date: string;
  notes: string;
}

const EMPTY_INVOICE_FORM: InvoiceFormState = {
  client_id: "",
  invoice_number: "",
  project_id: "",
  issue_date: "",
  due_date: "",
  notes: "",
};

function InvoicesTab({
  clients,
  projects,
  invoices,
  clientNameById,
  onMutate,
  setError,
}: {
  clients: Client[];
  projects: Project[];
  invoices: Invoice[];
  clientNameById: (id: string) => string;
  onMutate: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<InvoiceFormState>(EMPTY_INVOICE_FORM);
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [itemDesc, setItemDesc] = useState("");
  const [itemQty, setItemQty] = useState("1");
  const [itemPrice, setItemPrice] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const [statusUpdating, setStatusUpdating] = useState(false);

  const projectsForClient = form.client_id ? projects.filter(p => p.client_id === form.client_id) : projects;

  async function loadDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/business/finance/invoices/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoice detail");
    } finally {
      setDetailLoading(false);
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    await loadDetail(id);
  }

  async function handleCreate() {
    if (!form.client_id || !form.invoice_number.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/business/finance/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: form.client_id,
          invoice_number: form.invoice_number,
          project_id: form.project_id || undefined,
          issue_date: form.issue_date || undefined,
          due_date: form.due_date || undefined,
          notes: form.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`);
      setForm(EMPTY_INVOICE_FORM);
      setShowForm(false);
      await onMutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this invoice? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API}/api/business/finance/invoices/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      if (expandedId === id) { setExpandedId(null); setDetail(null); }
      await onMutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete invoice");
    }
  }

  async function handleAddItem(invoiceId: string) {
    if (!itemDesc.trim()) return;
    setAddingItem(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/business/finance/invoices/${invoiceId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: itemDesc,
          quantity: parseFloat(itemQty) || 1,
          unit_price: parseFloat(itemPrice) || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`);
      setItemDesc("");
      setItemQty("1");
      setItemPrice("");
      await loadDetail(invoiceId);
      await onMutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add line item");
    } finally {
      setAddingItem(false);
    }
  }

  async function handleStatusChange(invoiceId: string, status: InvoiceStatus) {
    setStatusUpdating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/business/finance/invoices/${invoiceId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`);
      await loadDetail(invoiceId);
      await onMutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusUpdating(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="biz-btn biz-btn-primary" onClick={() => setShowForm(v => !v)}>
          <Plus size={14} /> New Invoice
        </button>
      </div>

      {showForm && (
        <div className="biz-card" style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="biz-field-label">Client *</label>
              <select className="biz-select" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value, project_id: "" })}>
                <option value="">Select a client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="biz-field-label">Invoice Number *</label>
              <input className="biz-input" value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} placeholder="INV-1001" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="biz-field-label">Project</label>
              <select className="biz-select" value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
                <option value="">None</option>
                {projectsForClient.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="biz-field-label">Issue Date</label>
              <input className="biz-input" type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} />
            </div>
            <div>
              <label className="biz-field-label">Due Date</label>
              <input className="biz-input" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="biz-field-label">Notes</label>
            <textarea className="biz-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="biz-btn biz-btn-ghost" onClick={() => { setShowForm(false); setForm(EMPTY_INVOICE_FORM); }}>Cancel</button>
            <button className="biz-btn biz-btn-primary" disabled={creating || !form.client_id || !form.invoice_number.trim()} onClick={handleCreate}>
              {creating ? <Loader2 size={14} className="biz-spin" /> : <Plus size={14} />} Save
            </button>
          </div>
        </div>
      )}

      <div className="biz-card" style={{ padding: 0 }}>
        {invoices.length === 0 ? (
          <div className="biz-empty">
            <div className="biz-empty-icon"><Receipt size={34} style={{ margin: "0 auto" }} /></div>
            <p className="biz-empty-title">No invoices yet</p>
            <p className="biz-empty-body">Create an invoice for a client to start tracking billing.</p>
          </div>
        ) : (
          <div className="biz-list">
            {invoices.map(inv => {
              const expanded = expandedId === inv.id;
              return (
                <div key={inv.id}>
                  <div className="biz-row biz-row-hover" style={{ cursor: "pointer" }} onClick={() => toggleExpand(inv.id)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="biz-row-title">{inv.invoice_number} — {clientNameById(inv.client_id)}</div>
                      <div className="biz-row-sub">
                        {inv.due_date ? `Due ${inv.due_date}` : "No due date"} · <span className="biz-mono">{currency(inv.total)}</span>
                      </div>
                    </div>
                    <span className={invoiceBadgeClass(inv.status)}>{inv.status}</span>
                    <button className="biz-btn biz-btn-icon biz-btn-danger-ghost" onClick={e => { e.stopPropagation(); handleDelete(inv.id); }} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {expanded && (
                    <div style={{ padding: "16px 18px 20px", borderBottom: "1px solid var(--biz-border)", background: "var(--biz-bg-elevated)" }}>
                      {detailLoading || !detail ? (
                        <div style={{ textAlign: "center", padding: 20, color: "var(--biz-text-muted)" }}>
                          <Loader2 size={16} className="biz-spin" />
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                            <span className="biz-field-label" style={{ marginBottom: 0 }}>Status</span>
                            <select
                              className="biz-select"
                              style={{ width: 160 }}
                              value={detail.status}
                              disabled={statusUpdating}
                              onChange={e => handleStatusChange(inv.id, e.target.value as InvoiceStatus)}
                            >
                              {INVOICE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>

                          <div className="biz-card-flat" style={{ marginBottom: 14 }}>
                            <div className="biz-list">
                              {detail.line_items.length === 0 ? (
                                <div style={{ padding: 14, fontSize: 12.5, color: "var(--biz-text-muted)" }}>No line items yet.</div>
                              ) : (
                                detail.line_items.map(li => (
                                  <div key={li.id} className="biz-row" style={{ padding: "10px 14px" }}>
                                    <div style={{ flex: 1 }} className="biz-row-title">{li.description}</div>
                                    <div className="biz-row-sub biz-mono">{li.quantity} × {currency(li.unit_price)}</div>
                                    <div className="biz-mono" style={{ minWidth: 90, textAlign: "right", fontWeight: 600 }}>{currency(li.line_total)}</div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                            <div style={{ flex: 2 }}>
                              <label className="biz-field-label">Description</label>
                              <input className="biz-input" value={itemDesc} onChange={e => setItemDesc(e.target.value)} placeholder="Design work" />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label className="biz-field-label">Qty</label>
                              <input className="biz-input" type="number" value={itemQty} onChange={e => setItemQty(e.target.value)} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label className="biz-field-label">Unit Price</label>
                              <input className="biz-input" type="number" value={itemPrice} onChange={e => setItemPrice(e.target.value)} />
                            </div>
                            <button className="biz-btn biz-btn-sm" disabled={addingItem || !itemDesc.trim()} onClick={() => handleAddItem(inv.id)}>
                              {addingItem ? <Loader2 size={12} className="biz-spin" /> : "Add"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Expenses tab ──────────────────────────────────────────────────────── */

interface ExpenseFormState {
  description: string;
  amount: string;
  project_id: string;
  category: ExpenseCategory;
  expense_date: string;
  notes: string;
}

const EMPTY_EXPENSE_FORM: ExpenseFormState = {
  description: "",
  amount: "",
  project_id: "",
  category: "other",
  expense_date: "",
  notes: "",
};

function ExpensesTab({
  projects,
  expenses,
  onMutate,
  setError,
}: {
  projects: Project[];
  expenses: Expense[];
  onMutate: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExpenseFormState>(EMPTY_EXPENSE_FORM);
  const [creating, setCreating] = useState(false);

  const projectTitleById = (id: string | null) => projects.find(p => p.id === id)?.title;

  async function handleCreate() {
    if (!form.description.trim() || !form.amount) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/business/finance/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description,
          amount: parseFloat(form.amount) || 0,
          project_id: form.project_id || undefined,
          category: form.category,
          expense_date: form.expense_date || undefined,
          notes: form.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`);
      setForm(EMPTY_EXPENSE_FORM);
      setShowForm(false);
      await onMutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create expense");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this expense? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API}/api/business/finance/expenses/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      await onMutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete expense");
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="biz-btn biz-btn-primary" onClick={() => setShowForm(v => !v)}>
          <Plus size={14} /> New Expense
        </button>
      </div>

      {showForm && (
        <div className="biz-card" style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="biz-field-label">Description *</label>
              <input className="biz-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Figma subscription" />
            </div>
            <div>
              <label className="biz-field-label">Amount *</label>
              <input className="biz-input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="45.00" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="biz-field-label">Project</label>
              <select className="biz-select" value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="biz-field-label">Category</label>
              <select className="biz-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="biz-field-label">Date</label>
              <input className="biz-input" type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="biz-field-label">Notes</label>
            <textarea className="biz-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="biz-btn biz-btn-ghost" onClick={() => { setShowForm(false); setForm(EMPTY_EXPENSE_FORM); }}>Cancel</button>
            <button className="biz-btn biz-btn-primary" disabled={creating || !form.description.trim() || !form.amount} onClick={handleCreate}>
              {creating ? <Loader2 size={14} className="biz-spin" /> : <Plus size={14} />} Save
            </button>
          </div>
        </div>
      )}

      <div className="biz-card" style={{ padding: 0 }}>
        {expenses.length === 0 ? (
          <div className="biz-empty">
            <div className="biz-empty-icon"><Receipt size={34} style={{ margin: "0 auto" }} /></div>
            <p className="biz-empty-title">No expenses yet</p>
            <p className="biz-empty-body">Log software, contractor, travel, and other project costs here.</p>
          </div>
        ) : (
          <div className="biz-list">
            {expenses.map(exp => (
              <div key={exp.id} className="biz-row biz-row-hover">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="biz-row-title">{exp.description}</div>
                  <div className="biz-row-sub">
                    {exp.category}{exp.expense_date ? ` · ${exp.expense_date}` : ""}{projectTitleById(exp.project_id) ? ` · ${projectTitleById(exp.project_id)}` : ""}
                  </div>
                </div>
                <div className="biz-mono" style={{ minWidth: 90, textAlign: "right", fontWeight: 600 }}>{currency(exp.amount)}</div>
                <button className="biz-btn biz-btn-icon biz-btn-danger-ghost" onClick={() => handleDelete(exp.id)} title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
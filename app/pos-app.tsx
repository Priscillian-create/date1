"use client";

import {
  AlertTriangle,
  BarChart3,
  Beef,
  Check,
  ClipboardList,
  Coins,
  LogOut,
  Minus,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  stock_quantity: number;
  low_stock_threshold: number;
  cost_price: number;
  sale_price: number;
  active: boolean;
};

type Sale = {
  id: string;
  receipt_no: string;
  total: number;
  cost_total: number;
  profit: number;
  payment_method: string;
  created_at: string;
  sync_status?: "synced" | "pending" | "failed";
};

type SaleItem = {
  id: string;
  sale_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type CartLine = {
  product: Product;
  quantity: number;
};

type OfflineSale = {
  id: string;
  receipt_no: string;
  payment_method: string;
  created_at: string;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    unit_cost: number;
  }>;
  total: number;
  cost_total: number;
  profit: number;
};

type UserRole = "admin" | "cashier";

type DraftProduct = {
  name: string;
  sku: string;
  category: string;
  unit: string;
  stock_quantity: string;
  low_stock_threshold: string;
  cost_price: string;
  sale_price: string;
};

const emptyProduct: DraftProduct = {
  name: "",
  sku: "",
  category: "Frozen Foods",
  unit: "pack",
  stock_quantity: "0",
  low_stock_threshold: "5",
  cost_price: "0",
  sale_price: "0",
};

const money = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

const supabase = createClient();
const adminEmails = ["priscillianneoma804@gmail.com"];
const productsCacheKey = "pagerry-products-cache";
const salesCacheKey = "pagerry-sales-cache";
const pendingSalesKey = "pagerry-pending-sales";

const readStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeStorage = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const makeOfflineReceiptNo = () =>
  `PGF-OFF-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

const toLocalDateInputValue = (value: string) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function PosApp() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>("cashier");
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [pendingSales, setPendingSales] = useState<OfflineSale[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastReceipt, setLastReceipt] = useState<{
    sale: Sale;
    items: SaleItem[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [selectedSalesDate, setSelectedSalesDate] = useState("");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [draft, setDraft] = useState<DraftProduct>(emptyProduct);
  const [editing, setEditing] = useState<Product | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const isAdmin =
    role === "admin" || adminEmails.includes(user?.email?.toLowerCase() ?? "");

  const loadData = async () => {
    if (!user) return;
    const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
    const cachedSales = readStorage<Sale[]>(salesCacheKey, []);
    const cachedPendingSales = readStorage<OfflineSale[]>(pendingSalesKey, []);
    setProducts(cachedProducts);
    setSales(cachedSales);
    setPendingSales(cachedPendingSales);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSyncMessage("Offline mode. Sales will sync when the network returns.");
      return;
    }

    setIsBusy(true);
    const [productsResult, salesResult] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("sales")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (productsResult.error || salesResult.error) {
      setSyncMessage("Using saved offline data. Could not refresh from Supabase.");
    } else {
      const remoteProducts = productsResult.data ?? [];
      const remoteSales = salesResult.data ?? [];
      setProducts(remoteProducts);
      setSales(remoteSales);
      writeStorage(productsCacheKey, remoteProducts);
      writeStorage(salesCacheKey, remoteSales);
      setSyncMessage("");
    }
    setIsBusy(false);
  };

  useEffect(() => {
    const initializeSession = async () => {
      setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
      setProducts(readStorage<Product[]>(productsCacheKey, []));
      setSales(readStorage<Sale[]>(salesCacheKey, []));
      setPendingSales(readStorage<OfflineSale[]>(pendingSalesKey, []));
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
      setSessionChecked(true);
    };

    void initializeSession();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setCart([]);
    });

    return () => subscription.unsubscribe();
  }, []);

  const syncPendingSales = async () => {
    const queue = readStorage<OfflineSale[]>(pendingSalesKey, []);
    if (!user || !queue.length || isSyncing) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    setIsSyncing(true);
    setSyncMessage(`Syncing ${queue.length} pending sale${queue.length === 1 ? "" : "s"}...`);
    const remaining: OfflineSale[] = [];

    for (const sale of queue) {
      const { error } = await supabase.rpc("checkout_sale", {
        payment_method_input: sale.payment_method,
        items_input: sale.items.map((item) => ({
          product_id: item.product_id,
          quantity: Number(item.quantity.toFixed(2)),
        })),
      });

      if (error) {
        remaining.push(sale);
      }
    }

    writeStorage(pendingSalesKey, remaining);
    setPendingSales(remaining);

    if (remaining.length) {
      setSyncMessage(
        `${remaining.length} sale${remaining.length === 1 ? "" : "s"} still pending. Check stock or connection.`,
      );
    } else {
      setSyncMessage("All offline sales synced.");
      await loadData();
    }
    setIsSyncing(false);
  };

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void syncPendingSales();
    };
    const goOffline = () => {
      setIsOnline(false);
      setSyncMessage("Offline mode. Sales will sync when the network returns.");
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [user]);

  useEffect(() => {
    if (user) {
      const loadRole = async () => {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("email", user.email?.toLowerCase())
          .maybeSingle();
        setRole(data?.role === "admin" ? "admin" : "cashier");
      };

      void loadRole();
      void loadData();
    } else {
      setRole("cashier");
      setPendingSales(readStorage<OfflineSale[]>(pendingSalesKey, []));
    }
  }, [user]);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);
    setAuthMessage("");

    const authResult = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });

    if (authResult.error) {
      setAuthMessage(authResult.error.message);
    } else {
      setAuthEmail("");
      setAuthPassword("");
    }

    setIsBusy(false);
  };

  const signOut = async () => {
    setIsBusy(true);
    await supabase.auth.signOut();
    setIsBusy(false);
  };

  const filteredProducts = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return products;
    return products.filter((product) =>
      [product.name, product.sku, product.category]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(cleanQuery)),
    );
  }, [products, query]);

  const totals = useMemo(() => {
    const total = cart.reduce(
      (sum, line) => sum + line.quantity * line.product.sale_price,
      0,
    );
    const cost = cart.reduce(
      (sum, line) => sum + line.quantity * line.product.cost_price,
      0,
    );
    return { total, cost, profit: total - cost };
  }, [cart]);

  const todaySales = useMemo(() => {
    const today = new Date().toDateString();
    return sales.filter((sale) => new Date(sale.created_at).toDateString() === today);
  }, [sales]);

  const lowStockProducts = useMemo(
    () =>
      products.filter(
        (product) => product.stock_quantity <= product.low_stock_threshold,
      ),
    [products],
  );

  const visibleSales = useMemo(() => {
    if (!selectedSalesDate) return sales;
    return sales.filter((sale) => {
      return toLocalDateInputValue(sale.created_at) === selectedSalesDate;
    });
  }, [sales, selectedSalesDate]);

  const visibleSalesTotals = useMemo(
    () => ({
      total: visibleSales.reduce((sum, sale) => sum + sale.total, 0),
      profit: visibleSales.reduce((sum, sale) => sum + sale.profit, 0),
    }),
    [visibleSales],
  );

  const addToCart = (product: Product) => {
    if (product.stock_quantity <= 0) {
      return;
    }

    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock_quantity) return current;
        return current.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: line.quantity + 0.5 }
            : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  };

  const setCartQuantity = (productId: string, quantity: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.product.id === productId
            ? {
                ...line,
                quantity: Math.min(
                  Math.max(quantity, 0.5),
                  line.product.stock_quantity,
                ),
              }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const checkout = async () => {
    if (!cart.length) return;
    setIsBusy(true);
    setCheckoutMessage("");

    const offlineSale: OfflineSale = {
      id: crypto.randomUUID(),
      receipt_no: makeOfflineReceiptNo(),
      payment_method: paymentMethod,
      created_at: new Date().toISOString(),
      items: cart.map((line) => ({
        product_id: line.product.id,
        product_name: line.product.name,
        quantity: Number(line.quantity.toFixed(2)),
        unit_price: line.product.sale_price,
        unit_cost: line.product.cost_price,
      })),
      total: totals.total,
      cost_total: totals.cost,
      profit: totals.profit,
    };

    const completeOfflineSale = () => {
      const nextQueue = [...readStorage<OfflineSale[]>(pendingSalesKey, []), offlineSale];
      const localSale: Sale = {
        id: offlineSale.id,
        receipt_no: offlineSale.receipt_no,
        total: offlineSale.total,
        cost_total: offlineSale.cost_total,
        profit: offlineSale.profit,
        payment_method: offlineSale.payment_method,
        created_at: offlineSale.created_at,
        sync_status: "pending",
      };
      const localItems: SaleItem[] = offlineSale.items.map((item) => ({
        id: crypto.randomUUID(),
        sale_id: offlineSale.id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.quantity * item.unit_price,
      }));
      const nextProducts = products.map((product) => {
        const sold = offlineSale.items.find((item) => item.product_id === product.id);
        return sold
          ? {
              ...product,
              stock_quantity: Number(
                Math.max(product.stock_quantity - sold.quantity, 0).toFixed(2),
              ),
            }
          : product;
      });
      const nextSales = [localSale, ...sales].slice(0, 500);

      writeStorage(pendingSalesKey, nextQueue);
      writeStorage(productsCacheKey, nextProducts);
      writeStorage(salesCacheKey, nextSales);
      setPendingSales(nextQueue);
      setProducts(nextProducts);
      setSales(nextSales);
      setLastReceipt({ sale: localSale, items: localItems });
      setCart([]);
      setCheckoutMessage("Sale saved offline. It will sync when online.");
      setSyncMessage(`${nextQueue.length} pending sale${nextQueue.length === 1 ? "" : "s"} waiting to sync.`);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      completeOfflineSale();
      setIsBusy(false);
      return;
    }

    const { data: saleId, error } = await supabase.rpc("checkout_sale", {
      payment_method_input: paymentMethod,
      items_input: cart.map((line) => ({
        product_id: line.product.id,
        quantity: Number(line.quantity.toFixed(2)),
      })),
    });

    if (error) {
      const networkFailure =
        error.message.toLowerCase().includes("failed to fetch") ||
        error.message.toLowerCase().includes("network") ||
        error.message.toLowerCase().includes("fetch");

      if (networkFailure) {
        completeOfflineSale();
      } else {
        setCheckoutMessage(error.message);
      }
    } else {
      const [saleResult, itemsResult] = await Promise.all([
        supabase.from("sales").select("*").eq("id", saleId).single(),
        supabase
          .from("sale_items")
          .select("*")
          .eq("sale_id", saleId)
          .order("created_at", { ascending: true }),
      ]);

      if (saleResult.error || itemsResult.error) {
        setCheckoutMessage("Sale completed, but receipt could not be loaded.");
      } else {
        setLastReceipt({
          sale: saleResult.data,
          items: itemsResult.data ?? [],
        });
        setCheckoutMessage("Sale completed.");
      }
      setCart([]);
      await loadData();
    }
    setIsBusy(false);
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) return;
    setIsBusy(true);
    const payload = {
      name: draft.name.trim(),
      sku: draft.sku.trim() || null,
      category: draft.category.trim() || null,
      unit: draft.unit.trim() || "pack",
      stock_quantity: Number(draft.stock_quantity),
      low_stock_threshold: Number(draft.low_stock_threshold),
      cost_price: Number(draft.cost_price),
      sale_price: Number(draft.sale_price),
      active: true,
    };

    const result = editing
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert(payload);

    if (result.error) {
      console.error(result.error.message);
    } else {
      setDraft(emptyProduct);
      setEditing(null);
      await loadData();
    }
    setIsBusy(false);
  };

  const startEdit = (product: Product) => {
    setEditing(product);
    setDraft({
      name: product.name,
      sku: product.sku ?? "",
      category: product.category ?? "",
      unit: product.unit,
      stock_quantity: String(product.stock_quantity),
      low_stock_threshold: String(product.low_stock_threshold),
      cost_price: String(product.cost_price),
      sale_price: String(product.sale_price),
    });
  };

  const adjustStock = async (product: Product, delta: number) => {
    if (!isAdmin) return;
    const nextQuantity = Math.max(product.stock_quantity + delta, 0);
    setIsBusy(true);
    const { error } = await supabase
      .from("products")
      .update({ stock_quantity: nextQuantity })
      .eq("id", product.id);
    if (error) {
      console.error(error.message);
    } else {
      await loadData();
    }
    setIsBusy(false);
  };

  const deleteProduct = async (product: Product) => {
    if (!isAdmin || !user) return;
    setIsBusy(true);

    const { error: archiveError } = await supabase.from("deleted_products").insert({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      unit: product.unit,
      stock_quantity: product.stock_quantity,
      low_stock_threshold: product.low_stock_threshold,
      cost_price: product.cost_price,
      sale_price: product.sale_price,
      deleted_by_email: user.email ?? null,
    });

    const { error: updateError } = archiveError
      ? { error: archiveError }
      : await supabase.from("products").update({ active: false }).eq("id", product.id);

    if (updateError) {
      console.error(updateError.message);
    } else {
      setCart((current) =>
        current.filter((line) => line.product.id !== product.id),
      );
      await loadData();
    }
    setIsBusy(false);
  };

  const dashboard = [
    {
      label: "Today sales",
      value: money.format(todaySales.reduce((sum, sale) => sum + sale.total, 0)),
      icon: Coins,
    },
    {
      label: "Today profit",
      value: money.format(todaySales.reduce((sum, sale) => sum + sale.profit, 0)),
      icon: BarChart3,
    },
    {
      label: "Inventory value",
      value: money.format(
        products.reduce(
          (sum, product) => sum + product.stock_quantity * product.cost_price,
          0,
        ),
      ),
      icon: ClipboardList,
    },
    {
      label: "Low stock",
      value: String(lowStockProducts.length),
      icon: AlertTriangle,
    },
  ];

  if (!sessionChecked) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-lockup">
            <div className="brand-mark">
              <Beef size={24} aria-hidden="true" />
            </div>
            <div>
              <h1>Pagerry Froozens</h1>
              <p>Point of sale</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={handleAuth}>
          <div className="brand-lockup">
            <div className="brand-mark">
              <Beef size={24} aria-hidden="true" />
            </div>
            <div>
              <h1>Pagerry Froozens</h1>
              <p>Sign in to continue</p>
            </div>
          </div>

          <div className="auth-fields">
            <label>
              Email
              <input
                required
                type="email"
                autoComplete="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                minLength={6}
                autoComplete="current-password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
              />
            </label>
          </div>

          {authMessage ? <p className="auth-message">{authMessage}</p> : null}

          <button className="primary-action" type="submit" disabled={isBusy}>
            Sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="shell app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark sidebar-mark">
            PG
          </div>
          <div>
            <h1>Pagerry Froozens</h1>
            <span>Point of Sale</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <a className="active" href="#sales-pos">
            <ShoppingCart size={18} aria-hidden="true" />
            <span>Sales POS</span>
          </a>
          {isAdmin ? (
            <a href="#inventory">
              <ClipboardList size={18} aria-hidden="true" />
              <span>Inventory</span>
            </a>
          ) : null}
          <a href="#sales-history">
            <BarChart3 size={18} aria-hidden="true" />
            <span>Sales History</span>
          </a>
          <a href="#receipt">
            <Coins size={18} aria-hidden="true" />
            <span>Receipt</span>
          </a>
        </nav>

        <div className="side-metrics">
          <div className="side-metric">
            <small>Today Sales</small>
            <strong>{dashboard[0].value}</strong>
          </div>
          <div className="side-metric">
            <small>Today Profit</small>
            <strong>{dashboard[1].value}</strong>
          </div>
          <div className="side-metric">
            <small>{isOnline ? "Online" : "Offline"}</small>
            <strong>{pendingSales.length} pending</strong>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <h1>Sales POS</h1>
            <p>Point of sale, inventory control, and profit check</p>
          </div>
          <div className="top-actions">
          <strong className="role-badge">{isAdmin ? "Admin" : "Cashier"}</strong>
          <span>{user.email}</span>
          <button
            className="icon-button"
            onClick={() => {
              void syncPendingSales();
              void loadData();
            }}
            disabled={isBusy || isSyncing}
            title="Sync and refresh"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
          <button
            className="logout-button"
            onClick={signOut}
            disabled={isBusy}
          >
            <LogOut size={18} aria-hidden="true" />
            Logout
          </button>
        </div>
      </header>

      <div className="content">
      <section className="dashboard">
        <article className="metric sync-metric">
          <RefreshCw size={18} aria-hidden="true" />
          <span>{isOnline ? "Online" : "Offline"}</span>
          <strong>{pendingSales.length} pending</strong>
        </article>
        {dashboard.map((item) => (
          <article className="metric" key={item.label}>
            <item.icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      {syncMessage ? <p className="sync-message">{syncMessage}</p> : null}

      <section className="workspace" id="sales-pos">
        <div className="panel product-panel">
          <div className="panel-header">
            <div>
              <h2>Sell items</h2>
            </div>
            <div className="search-box">
              <Search size={17} aria-hidden="true" />
              <input
                placeholder="Search item or SKU"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="product-grid">
            {filteredProducts.length === 0 ? (
              <div className="empty-products">
                <PackagePlus size={26} aria-hidden="true" />
                <strong>No products yet</strong>
                <span>Add your first frozen item below.</span>
              </div>
            ) : (
              filteredProducts.map((product) => (
                <button
                  className="product-tile"
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={product.stock_quantity <= 0}
                >
                  <span className="product-name">{product.name}</span>
                  <span className="product-meta">
                    {product.category ?? "Frozen"} / {product.stock_quantity}{" "}
                    {product.unit}
                  </span>
                  <strong>{money.format(product.sale_price)}</strong>
                </button>
              ))
            )}
          </div>
        </div>

        <aside className="panel cart-panel">
          <div className="panel-header compact">
            <h2>Current sale</h2>
            <ShoppingCart size={20} aria-hidden="true" />
          </div>

          <div className="cart-lines">
            {cart.length === 0 ? (
              <p className="empty-state">Add frozen items to start a receipt.</p>
            ) : (
              cart.map((line) => (
                <div className="cart-line" key={line.product.id}>
                  <div>
                    <strong>{line.product.name}</strong>
                    <span>{money.format(line.product.sale_price)} each</span>
                  </div>
                  <div className="qty-controls">
                    <button
                      className="icon-button small"
                      onClick={() =>
                        setCartQuantity(line.product.id, line.quantity - 0.5)
                      }
                      title="Reduce quantity"
                    >
                      <Minus size={14} aria-hidden="true" />
                    </button>
                    <input
                      value={line.quantity}
                      type="number"
                      min="0.5"
                      step="0.5"
                      max={line.product.stock_quantity}
                      onChange={(event) =>
                        setCartQuantity(line.product.id, Number(event.target.value))
                      }
                    />
                    <button
                      className="icon-button small"
                      onClick={() =>
                        setCartQuantity(line.product.id, line.quantity + 0.5)
                      }
                      title="Increase quantity"
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    className="icon-button small"
                    onClick={() =>
                      setCart((current) =>
                        current.filter((item) => item.product.id !== line.product.id),
                      )
                    }
                    title="Remove item"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="totals">
            <div>
              <span>Cost</span>
              <strong>{money.format(totals.cost)}</strong>
            </div>
            <div>
              <span>Profit</span>
              <strong>{money.format(totals.profit)}</strong>
            </div>
            <div className="grand-total">
              <span>Total</span>
              <strong>{money.format(totals.total)}</strong>
            </div>
          </div>

          <div className="payment-row">
            {["cash", "transfer", "pos", "credit"].map((method) => (
              <button
                key={method}
                className={paymentMethod === method ? "selected" : ""}
                onClick={() => setPaymentMethod(method)}
              >
                {method}
              </button>
            ))}
          </div>

          <button
            className="primary-action"
            onClick={checkout}
            disabled={!cart.length || isBusy}
          >
            <Check size={18} aria-hidden="true" />
            Complete sale
          </button>
          {checkoutMessage ? (
            <p className="checkout-message">{checkoutMessage}</p>
          ) : null}
        </aside>
      </section>

      {lastReceipt ? (
        <section className="receipt-print" id="receipt">
          <div className="panel receipt-panel">
            <div className="panel-header compact">
              <div>
                <h2>Receipt</h2>
                <span>{lastReceipt.sale.receipt_no}</span>
              </div>
              <button className="secondary-action" onClick={() => window.print()}>
                Print
              </button>
            </div>
            <div className="receipt-paper">
              <div className="receipt-brand">
                <div className="receipt-logo">
                  <Beef size={22} aria-hidden="true" />
                </div>
                <div>
                  <h3>Pagerry Froozens</h3>
                  <p>Frozen foods, neatly packed and ready.</p>
                </div>
              </div>

              <div className="receipt-meta">
                <div>
                  <span>Receipt No.</span>
                  <strong>{lastReceipt.sale.receipt_no}</strong>
                </div>
                <div>
                  <span>Date</span>
                  <strong>{new Date(lastReceipt.sale.created_at).toLocaleString()}</strong>
                </div>
              </div>

              <div className="receipt-items">
                {lastReceipt.items.map((item) => (
                  <div key={item.id}>
                    <span>{item.product_name}</span>
                    <small>
                      {item.quantity} x {money.format(item.unit_price)}
                    </small>
                    <strong>{money.format(item.line_total)}</strong>
                  </div>
                ))}
              </div>

              <div className="receipt-total-line">
                <span>Total</span>
                <strong>{money.format(lastReceipt.sale.total)}</strong>
              </div>
              <div className="receipt-total-line">
                <span>Payment</span>
                <strong>{lastReceipt.sale.payment_method}</strong>
              </div>
              <div className="receipt-footer">
                <strong>Thank you for shopping with us.</strong>
                <span>
                  Order on WhatsApp: 08141606223 and have it delivered to your
                  doorstep.
                </span>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
      <section className="management" id="inventory">
        <form className="panel product-form" onSubmit={saveProduct}>
          <div className="panel-header compact">
            <h2>{editing ? "Edit product" : "Add product"}</h2>
            <PackagePlus size={20} aria-hidden="true" />
          </div>
          <div className="form-grid">
            <label>
              Name
              <input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              SKU
              <input
                value={draft.sku}
                onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
              />
            </label>
            <label>
              Category
              <input
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
              />
            </label>
            <label>
              Unit
              <input
                value={draft.unit}
                onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
              />
            </label>
            <label>
              Stock
              <input
                type="number"
                min="0"
                step="0.5"
                value={draft.stock_quantity}
                onChange={(event) =>
                  setDraft({ ...draft, stock_quantity: event.target.value })
                }
              />
            </label>
            <label>
              Low alert
              <input
                type="number"
                min="0"
                step="0.5"
                value={draft.low_stock_threshold}
                onChange={(event) =>
                  setDraft({ ...draft, low_stock_threshold: event.target.value })
                }
              />
            </label>
            <label>
              Cost price
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.cost_price}
                onChange={(event) =>
                  setDraft({ ...draft, cost_price: event.target.value })
                }
              />
            </label>
            <label>
              Sale price
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.sale_price}
                onChange={(event) =>
                  setDraft({ ...draft, sale_price: event.target.value })
                }
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="primary-action slim" type="submit" disabled={isBusy}>
              {editing ? "Save changes" : "Add product"}
            </button>
            {editing ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setEditing(null);
                  setDraft(emptyProduct);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div className="panel stock-table">
          <div className="panel-header compact">
            <h2>Inventory control</h2>
            <span>{products.length} active items</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Stock</th>
                  <th>Cost</th>
                  <th>Sale</th>
                  <th>Margin</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <span>{product.sku || product.category || "No SKU"}</span>
                    </td>
                    <td
                      className={
                        product.stock_quantity <= product.low_stock_threshold
                          ? "warning"
                          : ""
                      }
                    >
                      {product.stock_quantity} {product.unit}
                    </td>
                    <td>{money.format(product.cost_price)}</td>
                    <td>{money.format(product.sale_price)}</td>
                    <td>{money.format(product.sale_price - product.cost_price)}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-button small"
                          onClick={() => adjustStock(product, -0.5)}
                          title="Reduce stock"
                        >
                          <Minus size={14} aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button small"
                          onClick={() => adjustStock(product, 0.5)}
                          title="Increase stock"
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                        <button
                          className="secondary-action compact-button"
                          onClick={() => startEdit(product)}
                        >
                          Edit
                        </button>
                        <button
                          className="danger-action compact-button"
                          onClick={() => deleteProduct(product)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      ) : null}

      <section className="history" id="sales-history">
        <div className="panel">
          <div className="panel-header history-header">
            <div>
              <h2>Sales history</h2>
              <span>
                {visibleSales.length} receipt{visibleSales.length === 1 ? "" : "s"} /
                Sales {money.format(visibleSalesTotals.total)} / Profit{" "}
                {money.format(visibleSalesTotals.profit)}
              </span>
            </div>
            <div className="date-filter">
              <label>
                Date
                <input
                  type="date"
                  value={selectedSalesDate}
                  onChange={(event) => setSelectedSalesDate(event.target.value)}
                />
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setSelectedSalesDate("")}
              >
                All dates
              </button>
            </div>
          </div>
          <div className="history-list">
            {visibleSales.map((sale) => (
              <article className="receipt" key={sale.id}>
                <div>
                  <strong>{sale.receipt_no}</strong>
                  <span>{new Date(sale.created_at).toLocaleString()}</span>
                  {sale.sync_status === "pending" ? <em>Pending sync</em> : null}
                </div>
                <div>
                  <span>{sale.payment_method}</span>
                  <strong>{money.format(sale.total)}</strong>
                </div>
                <div>
                  <span>Profit</span>
                  <strong>{money.format(sale.profit)}</strong>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      </div>
      </div>
    </main>
  );
}

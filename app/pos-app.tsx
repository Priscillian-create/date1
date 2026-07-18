"use client";

import {
  AlertTriangle,
  BarChart3,
  Beef,
  Check,
  ClipboardList,
  Coins,
  Download,
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

type PendingProductAction =
  | {
      id: string;
      type: "upsert";
      product: Product;
      created_at: string;
    }
  | {
      id: string;
      type: "delete";
      product: Product;
      deleted_by_email: string | null;
      created_at: string;
    };

type UserRole = "admin" | "cashier";
type AppView = "pos" | "inventory" | "reports" | "receipt";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

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
const pendingProductActionsKey = "pagerry-pending-product-actions";

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

const applyPendingProductActions = (
  baseProducts: Product[],
  actions: PendingProductAction[],
) => {
  let nextProducts = [...baseProducts];

  for (const action of actions) {
    if (action.type === "upsert") {
      const index = nextProducts.findIndex(
        (product) => product.id === action.product.id,
      );
      if (index >= 0) {
        nextProducts[index] = action.product;
      } else {
        nextProducts = [action.product, ...nextProducts];
      }
    } else {
      nextProducts = nextProducts.filter(
        (product) => product.id !== action.product.id,
      );
    }
  }

  return nextProducts.filter((product) => product.active);
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
  const [pendingProductActions, setPendingProductActions] = useState<
    PendingProductAction[]
  >([]);
  const [isOnline, setIsOnline] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastReceipt, setLastReceipt] = useState<{
    sale: Sale;
    items: SaleItem[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [selectedSalesDate, setSelectedSalesDate] = useState("");
  const [activeView, setActiveView] = useState<AppView>("pos");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [draft, setDraft] = useState<DraftProduct>(emptyProduct);
  const [editing, setEditing] = useState<Product | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const isAdmin =
    role === "admin" || adminEmails.includes(user?.email?.toLowerCase() ?? "");

  const loadData = async () => {
    if (!user) return;
    const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
    const cachedSales = readStorage<Sale[]>(salesCacheKey, []);
    const cachedPendingSales = readStorage<OfflineSale[]>(pendingSalesKey, []);
    const cachedProductActions = readStorage<PendingProductAction[]>(
      pendingProductActionsKey,
      [],
    );
    setProducts(applyPendingProductActions(cachedProducts, cachedProductActions));
    setSales(cachedSales);
    setPendingSales(cachedPendingSales);
    setPendingProductActions(cachedProductActions);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSyncMessage("Offline mode. Changes will sync when the network returns.");
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
      setProducts(applyPendingProductActions(remoteProducts, cachedProductActions));
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
      const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
      const cachedProductActions = readStorage<PendingProductAction[]>(
        pendingProductActionsKey,
        [],
      );
      setProducts(applyPendingProductActions(cachedProducts, cachedProductActions));
      setSales(readStorage<Sale[]>(salesCacheKey, []));
      setPendingSales(readStorage<OfflineSale[]>(pendingSalesKey, []));
      setPendingProductActions(cachedProductActions);
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
      setSessionChecked(true);
    };

    void initializeSession();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setCart([]);
    });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) {
      setSyncMessage(
        "Install will appear after the browser confirms this app is ready. On mobile, use Add to Home Screen.",
      );
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setIsInstalled(true);
    }
    setInstallPrompt(null);
  };

  const queueProductAction = (action: PendingProductAction) => {
    const queue = readStorage<PendingProductAction[]>(pendingProductActionsKey, []);
    const nextQueue = [
      ...queue.filter(
        (queued) => queued.product.id !== action.product.id,
      ),
      action,
    ];
    const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
    const nextProducts = applyPendingProductActions(cachedProducts, nextQueue);

    writeStorage(pendingProductActionsKey, nextQueue);
    setPendingProductActions(nextQueue);
    setProducts(nextProducts);
    setSyncMessage(
      `${nextQueue.length} inventory change${nextQueue.length === 1 ? "" : "s"} waiting to sync.`,
    );
  };

  const syncPendingProductActions = async () => {
    const queue = readStorage<PendingProductAction[]>(pendingProductActionsKey, []);
    if (!user || !queue.length) return true;
    if (typeof navigator !== "undefined" && !navigator.onLine) return false;

    setSyncMessage(
      `Syncing ${queue.length} inventory change${queue.length === 1 ? "" : "s"}...`,
    );
    const remaining: PendingProductAction[] = [];

    for (const action of queue) {
      if (action.type === "upsert") {
        const { error } = await supabase.from("products").upsert(action.product);
        if (error) remaining.push(action);
      } else {
        const { error: archiveError } = await supabase
          .from("deleted_products")
          .insert({
            product_id: action.product.id,
            name: action.product.name,
            sku: action.product.sku,
            category: action.product.category,
            unit: action.product.unit,
            stock_quantity: action.product.stock_quantity,
            low_stock_threshold: action.product.low_stock_threshold,
            cost_price: action.product.cost_price,
            sale_price: action.product.sale_price,
            deleted_by_email: action.deleted_by_email,
          });
        const { error: updateError } = archiveError
          ? { error: archiveError }
          : await supabase
              .from("products")
              .update({ active: false })
              .eq("id", action.product.id);
        if (updateError) remaining.push(action);
      }
    }

    writeStorage(pendingProductActionsKey, remaining);
    setPendingProductActions(remaining);

    if (remaining.length) {
      setSyncMessage(
        `${remaining.length} inventory change${remaining.length === 1 ? "" : "s"} still pending.`,
      );
      return false;
    }

    return true;
  };

  const syncPendingSales = async (skipBusyGuard = false) => {
    const queue = readStorage<OfflineSale[]>(pendingSalesKey, []);
    if (!user || !queue.length) return;
    if (!skipBusyGuard && isSyncing) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    if (!skipBusyGuard) setIsSyncing(true);
    const productsSynced = await syncPendingProductActions();
    if (!productsSynced) {
      if (!skipBusyGuard) setIsSyncing(false);
      return;
    }

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
    if (!skipBusyGuard) setIsSyncing(false);
  };

  const syncAllPending = async () => {
    if (!user || isSyncing) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    setIsSyncing(true);
    const productsSynced = await syncPendingProductActions();
    if (productsSynced) {
      await syncPendingSales(true);
    }
    setIsSyncing(false);
  };

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      void syncAllPending();
    };
    const goOffline = () => {
      setIsOnline(false);
      setSyncMessage("Offline mode. Changes will sync when the network returns.");
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
      setPendingProductActions(
        readStorage<PendingProductAction[]>(pendingProductActionsKey, []),
      );
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

  const visiblePaymentTotals = useMemo(
    () =>
      visibleSales.reduce(
        (totalsByPayment, sale) => {
          const method = sale.payment_method.toLowerCase();
          if (method.includes("cash")) totalsByPayment.cash += sale.total;
          else if (method.includes("pos") || method.includes("card")) {
            totalsByPayment.pos += sale.total;
          } else if (method.includes("transfer")) {
            totalsByPayment.transfer += sale.total;
          } else if (method.includes("credit")) {
            totalsByPayment.credit += sale.total;
          }
          return totalsByPayment;
        },
        { cash: 0, pos: 0, transfer: 0, credit: 0 },
      ),
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
      const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
      const nextCachedProducts = cachedProducts.map((product) => {
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
      writeStorage(productsCacheKey, nextCachedProducts.length ? nextCachedProducts : nextProducts);
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
    const product: Product = {
      id: editing?.id ?? crypto.randomUUID(),
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
    const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
    const nextCachedProducts = [
      product,
      ...cachedProducts.filter((item) => item.id !== product.id),
    ];
    const action: PendingProductAction = {
      id: crypto.randomUUID(),
      type: "upsert",
      product,
      created_at: new Date().toISOString(),
    };
    const applyLocalSave = () => {
      writeStorage(productsCacheKey, nextCachedProducts);
      setProducts((current) => [
        product,
        ...current.filter((item) => item.id !== product.id),
      ]);
      setDraft(emptyProduct);
      setEditing(null);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      applyLocalSave();
      queueProductAction(action);
      setIsBusy(false);
      return;
    }

    const result = await supabase.from("products").upsert(product);

    if (result.error) {
      applyLocalSave();
      queueProductAction(action);
    } else {
      applyLocalSave();
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
    const updatedProduct = {
      ...product,
      stock_quantity: Number(
        Math.max(product.stock_quantity + delta, 0).toFixed(2),
      ),
    };
    setIsBusy(true);
    const action: PendingProductAction = {
      id: crypto.randomUUID(),
      type: "upsert",
      product: updatedProduct,
      created_at: new Date().toISOString(),
    };
    const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
    const nextCachedProducts = [
      updatedProduct,
      ...cachedProducts.filter((item) => item.id !== product.id),
    ];
    const applyLocalStock = () => {
      writeStorage(productsCacheKey, nextCachedProducts);
      setProducts((current) =>
        current.map((item) => (item.id === product.id ? updatedProduct : item)),
      );
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      applyLocalStock();
      queueProductAction(action);
      setIsBusy(false);
      return;
    }

    const { error } = await supabase.from("products").upsert(updatedProduct);
    if (error) {
      applyLocalStock();
      queueProductAction(action);
    } else {
      applyLocalStock();
      await loadData();
    }
    setIsBusy(false);
  };

  const deleteProduct = async (product: Product) => {
    if (!isAdmin || !user) return;
    setIsBusy(true);
    const action: PendingProductAction = {
      id: crypto.randomUUID(),
      type: "delete",
      product,
      deleted_by_email: user.email ?? null,
      created_at: new Date().toISOString(),
    };
    const applyLocalDelete = () => {
      const cachedProducts = readStorage<Product[]>(productsCacheKey, []);
      const nextCachedProducts = cachedProducts.filter(
        (item) => item.id !== product.id,
      );
      writeStorage(productsCacheKey, nextCachedProducts);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      setCart((current) =>
        current.filter((line) => line.product.id !== product.id),
      );
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      applyLocalDelete();
      queueProductAction(action);
      setIsBusy(false);
      return;
    }

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
      applyLocalDelete();
      queueProductAction(action);
    } else {
      applyLocalDelete();
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
  const viewText: Record<AppView, { title: string; subtitle: string }> = {
    pos: {
      title: "Sales POS",
      subtitle: "Sell frozen items, track stock, and print receipts.",
    },
    inventory: {
      title: "Inventory",
      subtitle: "Add products, adjust stock, and manage prices.",
    },
    reports: {
      title: "Reports",
      subtitle: "Review sales, payment totals, profit, and history.",
    },
    receipt: {
      title: "Receipt",
      subtitle: "Preview and print the latest customer receipt.",
    },
  };

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
          <button
            className={activeView === "pos" ? "active" : ""}
            onClick={() => setActiveView("pos")}
          >
            <ShoppingCart size={18} aria-hidden="true" />
            <span>Sales POS</span>
          </button>
          {isAdmin ? (
            <button
              className={activeView === "inventory" ? "active" : ""}
              onClick={() => setActiveView("inventory")}
            >
              <ClipboardList size={18} aria-hidden="true" />
              <span>Inventory</span>
            </button>
          ) : null}
          <button
            className={activeView === "reports" ? "active" : ""}
            onClick={() => setActiveView("reports")}
          >
            <BarChart3 size={18} aria-hidden="true" />
            <span>Reports</span>
          </button>
          <button
            className={activeView === "receipt" ? "active" : ""}
            onClick={() => setActiveView("receipt")}
          >
            <Coins size={18} aria-hidden="true" />
            <span>Receipt</span>
          </button>
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
            <strong>{pendingSales.length + pendingProductActions.length} pending</strong>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <h1>{viewText[activeView].title}</h1>
            <p>{viewText[activeView].subtitle}</p>
          </div>
          <div className="top-actions">
          <strong className="role-badge">{isAdmin ? "Admin" : "Cashier"}</strong>
          <span>{user.email}</span>
          {!isInstalled ? (
            <button
              className="install-button"
              onClick={installApp}
              type="button"
            >
              <Download size={18} aria-hidden="true" />
              Install
            </button>
          ) : null}
          <button
            className="icon-button"
            onClick={() => {
              void syncAllPending();
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
      {(activeView === "pos" || activeView === "reports") ? (
        <section className="dashboard">
          <article className="metric sync-metric">
            <RefreshCw size={18} aria-hidden="true" />
            <span>{isOnline ? "Online" : "Offline"}</span>
            <strong>{pendingSales.length + pendingProductActions.length} pending</strong>
          </article>
          {dashboard.map((item) => (
            <article className="metric" key={item.label}>
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>
      ) : null}

      {syncMessage ? <p className="sync-message">{syncMessage}</p> : null}

      {activeView === "pos" ? (
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
      ) : null}

      {activeView === "receipt" ? (
        <section className="receipt-print" id="receipt">
          <div className="panel receipt-panel">
            <div className="panel-header compact">
              <div>
                <h2>Receipt</h2>
                <span>{lastReceipt ? lastReceipt.sale.receipt_no : "No receipt selected"}</span>
              </div>
              <button
                className="secondary-action"
                onClick={() => window.print()}
                disabled={!lastReceipt}
              >
                Print
              </button>
            </div>
            {lastReceipt ? (
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
            ) : (
              <div className="empty-products receipt-empty">
                <Coins size={26} aria-hidden="true" />
                <strong>No receipt yet</strong>
                <span>Complete a sale to preview and print the receipt here.</span>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {isAdmin && activeView === "inventory" ? (
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

      {activeView === "reports" ? (
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
          <div className="payment-summary">
            <article>
              <span>Total Profit</span>
              <strong>{money.format(visibleSalesTotals.profit)}</strong>
            </article>
            <article>
              <span>Total Cash Sales</span>
              <strong>{money.format(visiblePaymentTotals.cash)}</strong>
            </article>
            <article>
              <span>Total POS Sales</span>
              <strong>{money.format(visiblePaymentTotals.pos)}</strong>
            </article>
            <article>
              <span>Total Transfers</span>
              <strong>{money.format(visiblePaymentTotals.transfer)}</strong>
            </article>
            <article>
              <span>Total Credit</span>
              <strong>{money.format(visiblePaymentTotals.credit)}</strong>
            </article>
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
      ) : null}
      </div>
      </div>
    </main>
  );
}

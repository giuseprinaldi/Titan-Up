// Shared plumbing: rendering library, identity, API calls, routing, live rooms.
import { useState, useEffect, useRef, useCallback } from '/vendor/htm-preact.js';
export * from '/vendor/htm-preact.js';

// ---------- tiny store ----------
function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(next) {
      value = next;
      subs.forEach((fn) => fn(value));
    },
    use() {
      const [v, setV] = useState(value);
      useEffect(() => {
        subs.add(setV);
        setV(value);
        return () => subs.delete(setV);
      }, []);
      return v;
    },
  };
}

// ---------- who am I ----------
const USER_KEY = 'titanup.user';
function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}
const userStore = createStore(readUser());
export const useUser = userStore.use;
export const getUser = userStore.get;
export function setUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
  userStore.set(user);
}

// ---------- toasts ----------
const toastStore = createStore([]);
export const useToasts = toastStore.use;
let toastId = 0;
export function toast(message) {
  const id = ++toastId;
  toastStore.set([...toastStore.get().filter((t) => t.message !== message), { id, message }]);
  setTimeout(() => toastStore.set(toastStore.get().filter((t) => t.id !== id)), 5000);
}

// ---------- REST ----------
export async function api(method, path, body) {
  const user = getUser();
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${user.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && user) setUser(null);
  if (!res.ok) throw new Error(data.error || 'That did not work. Try again.');
  return data;
}

/** Run an API call and show any failure as a toast. Resolves to undefined on failure. */
export async function attempt(promise) {
  try {
    return await promise;
  } catch (err) {
    toast(err.message);
    return undefined;
  }
}

/** Load data for a page: { data, error, reload }. */
export function useFetch(path) {
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    api('GET', path).then(
      (data) => setState({ data, error: null }),
      (err) => setState((s) => ({ data: s.data, error: err.message })),
    );
  }, [path]);
  useEffect(() => {
    setState({ data: null, error: null });
    load();
  }, [load]);
  return { ...state, reload: load };
}

// ---------- routing ----------
const pathStore = createStore(location.pathname);
window.addEventListener('popstate', () => pathStore.set(location.pathname));
export const usePath = pathStore.use;
export function navigate(path) {
  if (path !== location.pathname) history.pushState(null, '', path);
  pathStore.set(path);
  window.scrollTo(0, 0);
}
/** onClick handler for in-app links that keeps ctrl/middle-click working. */
export function go(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href'));
}

// ---------- live room ----------
/**
 * Connect to a retro or health check. The server pushes a complete, per-person
 * view after every change, so `state` is always the truth.
 */
export function useRoom(kind, id) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('connecting'); // connecting | live | reconnecting | gone
  const socket = useRef(null);

  useEffect(() => {
    let ws;
    let stopped = false;
    let retries = 0;
    let timer;
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', kind, id, token: getUser()?.token }));
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') {
          retries = 0;
          // Remember how far this clock is from the server's, for the shared timer.
          msg.state.clockOffset = (msg.state.now ?? Date.now()) - Date.now();
          setState(msg.state);
          setStatus('live');
        } else if (msg.type === 'error') {
          toast(msg.message);
        } else if (msg.type === 'gone') {
          stopped = true;
          setStatus('gone');
        } else if (msg.type === 'unauthorized') {
          stopped = true;
          setUser(null);
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus('reconnecting');
        timer = setTimeout(open, Math.min(5000, 400 * 2 ** retries++));
      };
    };
    setState(null);
    setStatus('connecting');
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws.close();
    };
  }, [kind, id]);

  const send = useCallback((op, args) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'op', op, args }));
    else toast('Reconnecting. Try again in a moment.');
  }, []);

  return { state, status, send };
}

// ---------- formatting ----------
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
export const fmtDate = (ms) => dateFmt.format(new Date(ms));
export const fmtShortDate = (ms) => shortFmt.format(new Date(ms));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const fmtScore = (n) => (n == null ? 'n/a' : n.toFixed(1));

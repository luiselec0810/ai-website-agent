'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Send,
  Paperclip,
  X,
  Loader2,
  Upload,
  ImageIcon,
  FileText,
  Film,
  Plus,
  ChevronDown,
  Search,
  Wrench,
  Sparkles,
  Menu,
  Library,
} from 'lucide-react';
import clsx from 'clsx';
import {
  chatApi,
  changesApi,
  conversationsApi,
  mediaApi,
  type MediaItem,
} from '@/lib/api';
import type {
  ChatResponse,
  Change,
  Site,
  ChangePlan,
  ChatMessageRecord,
  ConversationChangeRecord,
} from '@/lib/types';
import { ChangePlanView } from './ChangePlan';
import { SiteInventoryBadge } from './SiteInventoryBadge';
import { QuickActions } from './QuickActions';
import { MessageBubble } from './MessageBubble';
import { ConversationDropdown } from './ConversationDropdown';
import { LibraryPanel } from './sidebar/LibraryPanel';
import { Pill } from './ui/Pill';
import { Button } from './ui/Button';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  plan?: ChangePlan;
  changeId?: string;
  changeStatus?: Change['status'];
}

interface AttachedFile {
  id: string;
  /**
   * `File` original subido desde el cliente. **Opcional** porque los items
   * adjuntados desde la WordPress Library (via `LibraryPanel`) ya están
   * en el server — no hay `File` local, sólo `media` con la URL/ID.
   */
  file?: File;
  localUrl: string;
  media?: MediaItem;
  status: 'uploading' | 'uploaded' | 'error';
  error?: string;
}

const ACCEPT_TYPES = 'image/*,video/*,application/pdf,audio/*';
const MAX_FILE_SIZE_MB = 50;

// Altura del textarea con auto-grow.
// - MIN_HEIGHT_PX = ~44px → alcanza para 1 línea del placeholder (estilo ChatGPT compacto).
// - MAX_HEIGHT_PX = ~200px → tope para que el chat no se expanda demasiado;
//   una vez alcanzado, el textarea hace scroll interno.
const TEXTAREA_MIN_HEIGHT_PX = 44;
const TEXTAREA_MAX_HEIGHT_PX = 200;

function fileToIcon(mime: string) {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return Film;
  return FileText;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Genera un `tabId` estable y único. Usa `crypto.randomUUID()` cuando está
 * disponible (todos los navegadores modernos + Node 19+) y cae a un fallback
 * basado en `Math.random + Date.now` si no.
 */
function newTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tab_' + newId();
}

function buildWelcome(siteName: string): Message {
  return {
    role: 'assistant',
    text: `¡Hola! Estoy conectado a **${siteName}**. Pregúntame lo que quieras sobre tu sitio o dime qué cambios quieres hacer.`,
  };
}

function mapLoadedMessages(
  msgs: ChatMessageRecord[],
  changes: ConversationChangeRecord[],
): Message[] {
  const sortedChanges = [...changes].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  let changeCursor = 0;
  return msgs.map((m) => {
    if (m.role === 'user') {
      return { role: 'user', text: m.content };
    }
    if (m.role !== 'assistant') {
      return { role: 'assistant', text: m.content };
    }
    const msgTs = new Date(m.created_at).getTime();
    let matched: ConversationChangeRecord | null = null;
    while (changeCursor < sortedChanges.length) {
      const ch = sortedChanges[changeCursor];
      const chTs = new Date(ch.created_at).getTime();
      if (chTs <= msgTs + 1500) {
        matched = ch;
        changeCursor++;
        break;
      }
      changeCursor++;
    }
    const trimmed = (m.content ?? '').trim();
    let displayText = m.content;
    if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && matched) {
      displayText = matched.description ?? matched.title ?? '';
    }
    if (!matched) {
      return { role: 'assistant', text: displayText };
    }
    let operations: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
    try {
      const raw = JSON.parse(matched.operations);
      if (Array.isArray(raw)) {
        operations = raw.map((op: { tool?: string; tool_name?: string; arguments?: Record<string, unknown> }) => ({
          tool: op.tool ?? op.tool_name ?? '',
          arguments: op.arguments ?? {},
        }));
      }
    } catch {
      // ignore parse error
    }
    return {
      role: 'assistant',
      text: displayText || matched.description || matched.title,
      plan: {
        title: matched.title,
        description: matched.description ?? '',
        operations,
      },
      changeId: matched.id,
      changeStatus: matched.status as Change['status'],
    };
  });
}

/**
 * Chip de archivo adjunto con preview.
 *
 * Soporta dos fuentes:
 *   - Upload local (`file: File` definido): tipo/nombre/tamaño vienen
 *     del `File` original.
 *   - WordPress Library (`file` undefined): tipo/nombre/tamaño vienen
 *     de `media` (MediaItem devuelto por el backend de WP).
 */
function AttachmentChip({
  attached,
  onRemove,
}: {
  attached: AttachedFile;
  onRemove: () => void;
}) {
  const previewUrl = attached.media?.url ?? attached.localUrl;
  const mime = attached.file?.type ?? attached.media?.mime_type ?? '';
  const displayName =
    attached.media?.title || attached.file?.name || `Media #${attached.media?.id ?? '?'}`;
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  const Icon = fileToIcon(mime);

  return (
    <div className="relative group flex flex-col bg-panel border border-panel-border rounded-card overflow-hidden w-32 h-32">
      <div className="flex-1 bg-surface flex items-center justify-center overflow-hidden">
        {isImage && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : isVideo && previewUrl ? (
          <video
            src={previewUrl}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
        ) : isAudio ? (
          <div className="flex flex-col items-center text-text-muted">
            <Film size={28} />
            <span className="text-[10px] mt-1">audio</span>
          </div>
        ) : (
          <div className="flex flex-col items-center text-text-muted px-2 text-center">
            <Icon size={28} />
            <span className="text-[10px] mt-1 uppercase">
              {mime.split('/')[1] ?? 'file'}
            </span>
          </div>
        )}

        {attached.status === 'uploading' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-white" />
          </div>
        )}
        {attached.status === 'error' && (
          <div className="absolute inset-0 bg-danger-soft/90 flex items-center justify-center text-danger text-xs p-2 text-center">
            ❌ {attached.error ?? 'Error'}
          </div>
        )}
        {attached.status === 'uploaded' && !attached.file && (
          <div
            className="absolute top-1 right-1 bg-accent text-white text-[9px] px-1.5 py-0.5 rounded font-medium"
            title="Adjunto desde WordPress Library"
          >
            WP
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 px-1.5 py-1 bg-panel border-t border-panel-border">
        <span className="text-[10px] text-text flex-1 truncate" title={displayName}>
          {displayName}
        </span>
        <button
          onClick={onRemove}
          className="text-text-muted hover:text-danger p-0.5 rounded hover:bg-surface"
          aria-label={`Quitar ${displayName}`}
        >
          <X size={12} />
        </button>
      </div>

      {attached.file?.size !== undefined && (
        <div className="absolute top-1 left-1 bg-black/70 text-white text-[9px] px-1 rounded opacity-0 group-hover:opacity-100 transition">
          {formatSize(attached.file.size)}
        </div>
      )}
    </div>
  );
}

const THINKING_PHASES = [
  { icon: 'sparkles', label: 'Analizando tu mensaje…' },
  { icon: 'search', label: 'Buscando contexto del sitio…' },
  { icon: 'tools', label: 'Ejecutando herramientas…' },
  { icon: 'plan', label: 'Generando plan de cambios…' },
];

function PhaseIcon({ name }: { name: string }) {
  switch (name) {
    case 'search':
      return <Search size={12} className="text-accent" />;
    case 'tools':
      return <Wrench size={12} className="text-accent" />;
    case 'plan':
      return <FileText size={12} className="text-accent" />;
    default:
      return <Sparkles size={12} className="text-accent" />;
  }
}

function ThinkingPanel() {
  const [phaseIdx, setPhaseIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhaseIdx((i) => (i + 1) % THINKING_PHASES.length), 1800);
    return () => clearInterval(id);
  }, []);
  const phase = THINKING_PHASES[phaseIdx];

  return (
    <div className="flex justify-start">
      <div className="bg-panel border border-panel-border rounded-bubble px-4 py-3 text-text-muted max-w-md">
        <div className="flex items-center gap-2 text-text">
          <Loader2 size={16} className="animate-spin text-accent" />
          <span className="font-medium">Pensando…</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
          <PhaseIcon name={phase.icon} />
          <span className="transition-opacity duration-300">{phase.label}</span>
        </div>
        <div className="mt-3 h-0.5 w-full bg-panel-border rounded overflow-hidden">
          <div className="h-full w-1/3 bg-accent/60 rounded animate-[loading-bar_1.5s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}

interface TraceStep {
  tool: string;
  status: 'success' | 'failed';
  summary: string;
}

function TracePanel({ trace }: { trace: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  const ok = trace.filter((s) => s.status === 'success').length;
  const ko = trace.filter((s) => s.status === 'failed').length;

  return (
    <div className="flex justify-start">
      <div className="bg-surface border border-panel-border rounded-card px-3 py-2 text-xs max-w-md w-full">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-text-muted hover:text-text transition w-full"
        >
          <ChevronDown
            size={12}
            className={clsx('transition-transform', open ? 'rotate-180' : '')}
          />
          <span>
            {trace.length} tool{trace.length !== 1 ? 's' : ''} ejecutada{trace.length !== 1 ? 's' : ''}
          </span>
          {ok > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-success-soft text-success">
              ✓ {ok}
            </span>
          )}
          {ko > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-danger-soft text-danger">
              ✗ {ko}
            </span>
          )}
        </button>
        {open && (
          <ul className="mt-2 space-y-1 border-t border-panel-border pt-2">
            {trace.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-text-muted">
                <span className={s.status === 'success' ? 'text-success' : 'text-danger'}>
                  {s.status === 'success' ? '✓' : '✗'}
                </span>
                <span className="font-mono text-[11px] text-accent">{s.tool}</span>
                <span className="flex-1 text-[11px] text-text/80 truncate">
                  {s.summary}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Lee el nombre del modelo desde env. Hook helper para el header del chat.
 */
function useModelDisplay(): { name: string; isDefault: boolean } {
  const [name, setName] = useState<string>('AI Website Agent');
  useEffect(() => {
    const fromEnv =
      process.env.NEXT_PUBLIC_LLM_MODEL ?? process.env.NEXT_PUBLIC_DEFAULT_MODEL;
    if (fromEnv) setName(fromEnv);
  }, []);
  return { name, isDefault: true };
}

export function ChatSession({
  siteId,
  site,
  tabId,
  onPendingChanges,
  conversationId: conversationIdProp,
  onToggleSidebar,
  modelName: modelNameProp,
  onConversationChange,
  onTitleChange,
  onActiveChange,
  onNewTab,
}: {
  siteId: string;
  site: Site;
  /**
   * Identificador estable de la tab que envuelve esta sesión. Lo usa el padre
   * (ChatTabs) para enrutar los callbacks al tab correcto. No se usa internamente
   * para lógica — sólo se emite en `onConversationChange`.
   */
  tabId: string;
  onPendingChanges: (changes: Change[]) => void;
  /**
   * ID de la conversación que esta sesión debe mostrar. `undefined` cuando es
   * un tab nuevo sin conversación todavía. A diferencia del `Chat` legacy, este
   * ID es controlado por el padre — la sesión NO lo lee de la URL ni de
   * localStorage. Cambios al prop disparan recarga del historial.
   */
  conversationId?: string;
  onToggleSidebar?: () => void;
  modelName?: string;
  /**
   * Notifica al padre cuando cambia el conversationId (útil para que el
   * contenedor de tabs actualice el título/URL).
   */
  onConversationChange?: (tabId: string, convId: string | undefined) => void;
  /**
   * Notifica al padre cuando el título de la conversación se conoce (lo trae
   * el endpoint `/conversations/:id/messages`). El padre lo usa para mostrar
   * el título en el tab bar.
   */
  onTitleChange?: (tabId: string, title: string | undefined) => void;
  /**
   * Notifica al padre sobre el change activo (el último awaiting_approval /
   * approved / executing) y sus resultados por op. Lo usa el RightPanel para
   * mostrar el bloque "Aprobación en curso" con badges por operación.
   */
  onActiveChange?: (
    change: Change | null,
    results: Array<{ tool: string; status: string; retries: number; error?: { message: string } }>
  ) => void;
  /**
   * Pide al padre que abra una nueva tab vacía. Lo invoca el botón "+ Nueva"
   * del header del chat.
   */
  onNewTab?: () => void;
}) {
  const welcome = buildWelcome(site.name);
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>(conversationIdProp);
  const [conversationTitle, setConversationTitle] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(!!conversationIdProp);
  const [attached, setAttached] = useState<AttachedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [lastAssistantTrace, setLastAssistantTrace] = useState<TraceStep[]>([]);
  const [pendingChangeId, setPendingChangeId] = useState<string | null>(null);
  const [changeResults, setChangeResults] = useState<Record<string, Array<{ tool: string; status: string; retries: number; error?: { code: string; message: string } }>>>({});
  // Popover del Library dentro del input: cuando está abierto muestra
  // los media del sitio y permite adjuntarlos al chat sin re-upload.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryPopoverRef = useRef<HTMLDivElement>(null);
  // Flag de hidratación: mientras no estemos montados en el cliente, evitamos
  // renderizar nada que dependa de tiempo/estado cargado asincronicamente.
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const loadedConvIdRef = useRef<string | undefined>(undefined);

  const { name: envModelName } = useModelDisplay();
  const modelName = modelNameProp ?? envModelName;

  // Marcar como montado al primer render del cliente. Hasta entonces evitamos
  // mostrar cualquier bloque cuyo contenido dependa de `Date.now()` o de un
  // fetch asincrónico, para que el HTML del SSR coincida con el del cliente
  // y no se dispare el warning de hidratación de Next.js.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Cleanup de object URLs al desmontar.
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // Click outside / Escape → cerrar el popover del Library.
  useEffect(() => {
    if (!libraryOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        libraryPopoverRef.current &&
        !libraryPopoverRef.current.contains(e.target as Node)
      ) {
        setLibraryOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLibraryOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [libraryOpen]);

  // Notificar al padre cuando cambie conversationId. El padre usa esto para
  // sincronizar el tab con la URL y para refrescar el título del tab.
  useEffect(() => {
    onConversationChange?.(tabId, conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Auto-scroll al fondo cuando hay nuevos mensajes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-grow del textarea: reset → medir scrollHeight → clampear entre
  // TEXTAREA_MIN_HEIGHT_PX y TEXTAREA_MAX_HEIGHT_PX. Cuando llega al tope
  // hace scroll interno (overflow-y-auto).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const desired = Math.min(
      ta.scrollHeight,
      TEXTAREA_MAX_HEIGHT_PX
    );
    const final = Math.max(TEXTAREA_MIN_HEIGHT_PX, desired);
    ta.style.height = `${final}px`;
    ta.style.overflowY = ta.scrollHeight > TEXTAREA_MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, [input]);

  // NOTA: la persistencia de `conversationId` en la URL (?c=…) y en localStorage
  // ya NO se hace acá — la maneja el padre (`<ChatTabs>`) que es el único que
  // sabe qué tab está activa y cómo se mapea a la URL del sitio.

  // Cargar historial cuando conversationId cambia a un valor que aún no cargamos.
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    if (!conversationId) {
      setLoadingHistory(false);
      return;
    }
    if (loadedConvIdRef.current === conversationId) return;
    loadedConvIdRef.current = conversationId;
    const mySeq = ++fetchSeqRef.current;
    setLoadingHistory(true);
    (async () => {
      try {
        const data = await conversationsApi.getMessages(conversationId);
        if (fetchSeqRef.current !== mySeq) return;
        // Capturar el título de la conversación para mostrarlo en el header
        // y emitirlo al padre (ChatTabs lo usa para el tab bar).
        const loadedTitle = data.conversation?.title;
        setConversationTitle(loadedTitle);
        onTitleChange?.(tabId, loadedTitle);
        if (data.messages.length === 0) {
          setMessages([welcome]);
        } else {
          setMessages(mapLoadedMessages(data.messages, data.changes));
        }
      } catch (err) {
        console.error('[Chat] load history failed:', err);
        if (fetchSeqRef.current !== mySeq) return;
        setMessages([
          {
            role: 'assistant',
            text: `⚠️ No pude cargar la conversación (${(err as Error).message}).`,
          },
          welcome,
        ]);
      } finally {
        setLoadingHistory(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // NOTA: la restauración desde localStorage ya no ocurre acá. La hacía el
  // `Chat` legacy cuando navegabas a `/sites/{id}` sin `?c=`. Con tabs, esa
  // responsabilidad la tiene el padre (`<ChatTabs>`): decide si abrir la
  // conversación del localStorage o arrancar una nueva tab vacía.

  const removeAttached = useCallback((id: string) => {
    setAttached((arr) => {
      const target = arr.find((a) => a.id === id);
      if (target?.localUrl) {
        URL.revokeObjectURL(target.localUrl);
        objectUrlsRef.current.delete(target.localUrl);
      }
      return arr.filter((a) => a.id !== id);
    });
  }, []);

  const uploadFile = useCallback(
    async (attached: AttachedFile) => {
      // Library items (sin `file`) ya están subidos en el WP server — no hay
      // nada que re-upload. `handleFiles` solo crea AttachedFile con `file`
      // cuando vienen de un input/drop local, así que el guard es defensivo.
      if (!attached.file) return;
      try {
        if (attached.file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          throw new Error(
            `Archivo demasiado grande (${formatSize(attached.file.size)} > ${MAX_FILE_SIZE_MB} MB)`
          );
        }
        const media = await mediaApi.upload(siteId, attached.file, { title: attached.file.name });
        setAttached((arr) =>
          arr.map((a) =>
            a.id === attached.id
              ? { ...a, status: 'uploaded', media }
              : a
          )
        );
      } catch (err) {
        setAttached((arr) =>
          arr.map((a) =>
            a.id === attached.id
              ? { ...a, status: 'error', error: (err as Error).message }
              : a
          )
        );
      }
    },
    [siteId]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const newAttached: AttachedFile[] = [];
      Array.from(files).forEach((file) => {
        const localUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(localUrl);
        newAttached.push({
          id: newId(),
          file,
          localUrl,
          status: 'uploading',
        });
      });
      setAttached((arr) => [...arr, ...newAttached]);
      newAttached.forEach(uploadFile);
    },
    [uploadFile]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  function startNewConversation() {
    // En el modelo de tabs, "Nueva" del header del chat pide al padre que
    // abra una nueva tab vacía en lugar de resetear esta misma sesión
    // (sería destructivo: perdería scroll, input a medio tipear, etc.).
    if (onNewTab) {
      onNewTab();
    }
  }

  async function send() {
    const text = input.trim();
    const ready = attached.filter((a) => a.status === 'uploaded' && a.media);
    if ((!text && ready.length === 0) || loading) return;
    setInput('');

    const filesCtx = ready
      .map((a) => {
        // Los adjuntos pueden venir del cliente (con `file`) o de la
        // WordPress Library (sin `file`, sólo `media`). El contexto que
        // mandamos al LLM usa SIEMPRE la info de `media` (es lo que el
        // backend tiene registrado); `file` es solo metadata local.
        const m = a.media!;
        return `[Archivo adjunto: "${m.title || a.file?.name || 'media'}" — media_id=${m.id}, url=${m.url}, mime=${m.mime_type || a.file?.type || 'application/octet-stream'}]`;
      })
      .join('\n');
    const fullMessage = filesCtx ? filesCtx + '\n' + text : text;
    const userDisplayText =
      ready.length > 0
        ? `📎 ${ready.length} archivo${ready.length > 1 ? 's' : ''} · ${text || ''}`.trim()
        : text;

    setAttached([]);

    setMessages((m) => [...m, { role: 'user', text: userDisplayText }]);
    setLoading(true);

    try {
      const res: ChatResponse = await chatApi.send({
        site_id: siteId,
        conversation_id: conversationId,
        message: fullMessage,
      });
      if (res.conversation_id) {
        loadedConvIdRef.current = res.conversation_id;
        if (res.conversation_id !== conversationId) {
          setConversationId(res.conversation_id);
        }
      }

      const filesAck =
        ready.length > 0
          ? `\n\n_(${ready.length} archivo${ready.length > 1 ? 's' : ''} subido${ready.length > 1 ? 's' : ''}: ${ready.map((a) => `media_id=${a.media!.id}`).join(', ')}. Puedes usarlos en widgets vía replace_image o update_widget.)_`
          : '';

      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: (res.text ?? '') + filesAck,
          plan: res.plan,
          changeId: res.change_id,
          changeStatus: res.change_id ? 'awaiting_approval' : undefined,
        },
      ]);

      if (res.tool_results && res.tool_results.length > 0) {
        const trace: TraceStep[] = res.tool_results.map((tr) => {
          const result = tr.result as { data?: unknown; items?: unknown[] } | undefined;
          let summary = '';
          if (result) {
            if (Array.isArray(result.items)) {
              summary = `${result.items.length} items`;
            } else if (Array.isArray(result)) {
              summary = `${result.length} items`;
            } else if (typeof result === 'object' && result !== null) {
              const keys = Object.keys(result);
              summary = keys.length <= 3 ? keys.join(', ') : `${keys.length} keys`;
            } else {
              summary = String(result).slice(0, 80);
            }
          }
          if (tr.error?.message) summary = `Error: ${tr.error.message}`;
          return {
            tool: tr.tool,
            status: tr.status === 'success' ? 'success' : 'failed',
            summary,
          };
        });
        setLastAssistantTrace(trace);
      } else {
        setLastAssistantTrace([]);
      }

      if (res.type === 'plan' && res.change_id) {
        const changes = await changesApi.list({ site_id: siteId, status: 'awaiting_approval' });
        onPendingChanges(changes);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `❌ Error: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Regenera la respuesta del assistant en `assistantIdx` reenviando el
   * mensaje del usuario que la produjo. NO agrega un nuevo mensaje de
   * usuario al chat (el original ya está ahí); reemplaza in-place la
   * respuesta vieja por la nueva.
   *
   * Limitación: si el mensaje original tenía archivos adjuntos, el prefijo
   * `📎 N archivo(s) · ` no nos permite reconstruir el contexto `[Archivo
   * adjunto: ...]` que se mandaba al backend. Regenerar mensajes con
   * adjuntos re-enviará solo el texto.
   */
  async function regenerate(assistantIdx: number) {
    if (loading) return;

    // Encontrar el user message inmediatamente anterior al assistant.
    let userMsgIdx = assistantIdx - 1;
    while (userMsgIdx >= 0 && messages[userMsgIdx].role !== 'user') {
      userMsgIdx--;
    }
    if (userMsgIdx < 0) return;

    // Extraer el texto original (strip "📎 N archivo(s) · " si está).
    const text = messages[userMsgIdx].text.replace(
      /^📎\s+\d+\s+archivos?\s+·\s*/,
      ''
    );

    // Reemplazar el assistant message viejo con un placeholder vacío
    // (mientras llega la nueva respuesta del backend).
    setMessages((m) => {
      if (assistantIdx >= m.length) return m;
      const updated = [...m];
      updated[assistantIdx] = { role: 'assistant', text: '' };
      return updated;
    });

    setLoading(true);
    setLastAssistantTrace([]);

    try {
      const res: ChatResponse = await chatApi.send({
        site_id: siteId,
        conversation_id: conversationId,
        message: text,
      });

      if (res.conversation_id && res.conversation_id !== conversationId) {
        loadedConvIdRef.current = res.conversation_id;
        setConversationId(res.conversation_id);
      }

      setMessages((m) => {
        if (assistantIdx >= m.length) return m;
        const updated = [...m];
        updated[assistantIdx] = {
          role: 'assistant',
          text: res.text ?? '',
          plan: res.plan,
          changeId: res.change_id,
          changeStatus: res.change_id ? 'awaiting_approval' : undefined,
        };
        return updated;
      });

      if (res.tool_results && res.tool_results.length > 0) {
        const trace: TraceStep[] = res.tool_results.map((tr) => {
          const result = tr.result as { data?: unknown; items?: unknown[] } | undefined;
          let summary = '';
          if (result) {
            if (Array.isArray(result.items)) {
              summary = `${result.items.length} items`;
            } else if (Array.isArray(result)) {
              summary = `${result.length} items`;
            } else if (typeof result === 'object' && result !== null) {
              const keys = Object.keys(result);
              summary = keys.length <= 3 ? keys.join(', ') : `${keys.length} keys`;
            } else {
              summary = String(result).slice(0, 80);
            }
          }
          if (tr.error?.message) summary = `Error: ${tr.error.message}`;
          return {
            tool: tr.tool,
            status: tr.status === 'success' ? 'success' : 'failed',
            summary,
          };
        });
        setLastAssistantTrace(trace);
      } else {
        setLastAssistantTrace([]);
      }

      if (res.type === 'plan' && res.change_id) {
        const changes = await changesApi.list({
          site_id: siteId,
          status: 'awaiting_approval',
        });
        onPendingChanges(changes);
      }
    } catch (err) {
      setMessages((m) => {
        if (assistantIdx >= m.length) return m;
        const updated = [...m];
        updated[assistantIdx] = {
          role: 'assistant',
          text: `❌ Error al regenerar: ${(err as Error).message}`,
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  async function approveChange(changeId: string) {
    if (pendingChangeId) return;
    setPendingChangeId(changeId);

    const opsCount = (() => {
      const msg = messages.find((mm) => mm.changeId === changeId);
      return msg?.plan?.operations.length ?? 0;
    })();
    if (opsCount > 0) {
      setChangeResults((prev) => ({
        ...prev,
        [changeId]: Array.from({ length: opsCount }, () => ({
          tool: '',
          status: 'pending',
          retries: 0,
        })),
      }));
    }

    try {
      const final = await changesApi.approveStream(changeId, (e) => {
        setChangeResults((prev) => {
          const cur = prev[changeId] ?? [];
          const next = [...cur];

          const ensureIndex = (idx: number) => {
            while (next.length <= idx) {
              next.push({ tool: '', status: 'pending', retries: 0 });
            }
          };

          switch (e.type) {
            case 'op:start': {
              ensureIndex(e.data.index);
              next[e.data.index] = {
                tool: e.data.tool,
                status: 'running',
                retries: 0,
              };
              break;
            }
            case 'op:success': {
              ensureIndex(e.data.index);
              next[e.data.index] = {
                tool: e.data.tool,
                status: 'success',
                retries: 0,
              };
              break;
            }
            case 'op:fail': {
              ensureIndex(e.data.index);
              next[e.data.index] = {
                tool: e.data.tool,
                status: 'failed',
                retries: 0,
                error: e.data.error,
              };
              break;
            }
            case 'op:skipped': {
              ensureIndex(e.data.index);
              next[e.data.index] = {
                tool: e.data.tool,
                status: 'skipped',
                retries: 0,
                error: e.data.error,
              };
              break;
            }
            case 'done': {
              if (Array.isArray(e.data.results)) {
                return { ...prev, [changeId]: e.data.results };
              }
              break;
            }
          }
          return { ...prev, [changeId]: next };
        });
      });

      setMessages((m) => {
        const updated = [...m];
        const idx = updated.findIndex((msg) => msg.changeId === changeId);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], changeStatus: final.status as Change['status'] };
        }
        return updated;
      });

      const changes = await changesApi.list({ site_id: siteId, status: 'awaiting_approval' });
      onPendingChanges(changes);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `❌ Error al aprobar: ${(err as Error).message}` },
      ]);
    } finally {
      setPendingChangeId(null);
    }
  }

  async function rejectChange(changeId: string) {
    try {
      await changesApi.reject(changeId);
      setMessages((m) => {
        const updated = [...m];
        const idx = updated.findIndex((msg) => msg.changeId === changeId);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], changeStatus: 'rolled_back' };
        }
        return updated;
      });
      const changes = await changesApi.list({ site_id: siteId, status: 'awaiting_approval' });
      onPendingChanges(changes);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `❌ Error al rechazar: ${(err as Error).message}` },
      ]);
    }
  }

  async function rollbackChange(changeId: string) {
    try {
      await changesApi.rollback(changeId);
      setMessages((m) => {
        const updated = [...m];
        const idx = updated.findIndex((msg) => msg.changeId === changeId);
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            changeStatus: 'rolled_back' as Change['status'],
          };
        }
        return updated;
      });
      const changes = await changesApi.list({ site_id: siteId });
      onPendingChanges(changes);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `❌ Error al revertir: ${(err as Error).message}` },
      ]);
    }
  }

  async function executeOperation(changeId: string, idx: number, skip?: boolean) {
    try {
      const res = await changesApi.executeOperation(changeId, idx, skip ?? false);
      setMessages((m) => {
        const updated = [...m];
        const idx2 = updated.findIndex((msg) => msg.changeId === changeId);
        if (idx2 >= 0) {
          updated[idx2] = {
            ...updated[idx2],
            text: `${skip ? 'Saltada' : 'Ejecutada'} la operación ${idx + 1}: ${res.status}`,
          };
        }
        return updated;
      });
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `❌ Error en op ${idx + 1}: ${(err as Error).message}` },
      ]);
      throw err;
    }
  }

  const readyCount = attached.filter((a) => a.status === 'uploaded').length;
  const uploadingCount = attached.filter((a) => a.status === 'uploading').length;

  // Encontrar el change activo (último awaiting_approval o approved/executing).
  const activeChange = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.changeId && m.changeStatus && m.changeStatus !== 'rolled_back' && m.changeStatus !== 'completed' && m.changeStatus !== 'failed') {
        // Construimos un Change sintético para el RightPanel.
        return {
          id: m.changeId,
          site_id: siteId,
          title: m.plan?.title ?? 'Cambio',
          description: m.plan?.description,
          status: m.changeStatus,
          created_at: new Date().toISOString(),
          operations: (m.plan?.operations ?? []).map((op, i) => ({
            id: `${m.changeId}-${i}`,
            tool_name: op.tool,
            arguments: op.arguments,
            status: 'pending',
          })),
        } as Change;
      }
    }
    return null;
  })();
  const activeChangeResults = activeChange
    ? changeResults[activeChange.id] ?? []
    : [];

  // Notificar al padre sobre el change activo (para el RightPanel).
  useEffect(() => {
    onActiveChange?.(activeChange, activeChangeResults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChange, activeChangeResults.length]);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col relative bg-surface pb-6"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-accent/20 backdrop-blur-sm border-2 border-dashed border-accent flex items-center justify-center pointer-events-none">
          <div className="bg-panel border-2 border-accent rounded-card p-6 shadow-popover flex flex-col items-center gap-2">
            <Upload size={48} className="text-accent animate-bounce" />
            <p className="text-text font-semibold text-lg">Suelta archivos aquí</p>
            <p className="text-text-muted text-sm">Imágenes, videos, PDFs y más</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 border-b border-panel-border bg-panel">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden flex items-center gap-1 text-xs text-text-muted hover:text-text transition px-2 py-1 rounded hover:bg-surface flex-shrink-0"
          aria-label="Abrir navegación"
        >
          <Menu size={14} />
          <span className="hidden xs:inline">Menú</span>
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <ConversationDropdown
            siteId={siteId}
            currentConversationId={conversationId}
            currentTitle={
              loadingHistory
                ? undefined
                : conversationTitle || (conversationId ? 'Sin título' : undefined)
            }
            loading={loadingHistory}
          />
        </div>

        {/* Badge del inventario: estado del cache + popover con refresh.
            Reemplaza al FAB que antes flotaba en la esquina inferior derecha.
            Ubicado junto al botón "+ Nueva" para que sea fácil de encontrar. */}
        <SiteInventoryBadge siteId={siteId} />

        <Button
          variant="soft"
          size="md"
          onClick={startNewConversation}
          disabled={loading || loadingHistory}
          className="flex-shrink-0"
          aria-label="Iniciar una conversación nueva"
          title="Iniciar una conversación nueva"
        >
          <Plus size={14} />
          Nueva
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-6 space-y-5">
        {messages.map((msg, i) => {
          const plan =
            msg.plan && msg.changeId
              ? {
                  planNode: (
                    <ChangePlanView
                      plan={msg.plan}
                      changeId={msg.changeId}
                      status={
                        msg.changeStatus && msg.changeStatus !== 'draft' && msg.changeStatus !== 'planned'
                          ? msg.changeStatus
                          : 'awaiting_approval'
                      }
                      onApprove={approveChange}
                      onReject={rejectChange}
                      onRollback={rollbackChange}
                      onExecuteOperation={executeOperation}
                      isApproving={pendingChangeId === msg.changeId}
                      executionResults={changeResults[msg.changeId]}
                    />
                  ),
                }
              : null;

          return (
            <MessageBubble
              key={i}
              role={msg.role}
              text={msg.text}
              actions={plan?.planNode}
              showAssistantName={msg.role === 'assistant' && i === 0}
              onRegenerate={
                msg.role === 'assistant' ? () => regenerate(i) : undefined
              }
            />
          );
        })}
        {loading && <ThinkingPanel />}
        {lastAssistantTrace.length > 0 && !loading && (
          <TracePanel trace={lastAssistantTrace} />
        )}
      </div>

      <div className="border-t border-panel-border p-3 md:p-4 space-y-3 bg-panel">
        {attached.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-text-muted flex items-center gap-2">
              <Paperclip size={12} />
              <span>
                {readyCount} listo{readyCount !== 1 ? 's' : ''}
                {uploadingCount > 0 && `, ${uploadingCount} subiendo...`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {attached.map((a) => (
                <AttachmentChip
                  key={a.id}
                  attached={a}
                  onRemove={() => removeAttached(a.id)}
                />
              ))}
            </div>
          </div>
        )}

        <QuickActions
          inputEmpty={input.trim().length === 0}
          onPickPrompt={(p) => setInput(p)}
        />

        <div
          className={clsx(
            'flex items-center gap-1.5',
            'bg-surface border border-panel-border rounded-card',
            'pl-1.5 pr-1.5 py-1.5',
            'focus-within:border-accent/60',
            'transition-colors'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_TYPES}
            multiple
            onChange={handleFileInput}
            className="hidden"
          />

          {/* Paperclip (icon-only) — vive dentro del input, alineado al fondo. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            aria-label="Adjuntar archivo"
            title="Adjuntar archivo (también podés arrastrar y soltar)"
            className={clsx(
              'flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full',
              'text-text-muted hover:text-text hover:bg-panel',
              'transition disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <Paperclip size={18} />
          </button>

          {/*
            Library — abre un popover con la WordPress Media Library para
            adjuntar archivos ya subidos al sitio sin re-upload. Se monta
            como hermano del input (no dentro) porque es un overlay que
            aparece arriba de toda la barra.
          */}
          <div ref={libraryPopoverRef} className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setLibraryOpen((o) => !o)}
              disabled={loading}
              aria-label="Adjuntar desde WordPress Library"
              aria-expanded={libraryOpen}
              aria-haspopup="dialog"
              title="Adjuntar desde WordPress Library"
              className={clsx(
                'inline-flex items-center justify-center w-8 h-8 rounded-full',
                'text-text-muted hover:text-text hover:bg-panel',
                'transition disabled:opacity-50 disabled:cursor-not-allowed',
                libraryOpen && 'bg-panel text-text'
              )}
            >
              <Library size={18} />
            </button>
            {libraryOpen && (
              <div
                className="absolute bottom-full right-0 mb-2 z-40 w-80 max-w-[90vw]"
                role="dialog"
                aria-label="WordPress Media Library"
              >
                <LibraryPanel
                  siteId={siteId}
                  onSelect={(item) => {
                    // Adjuntar el item al chat sin re-upload: el archivo
                    // ya vive en el server de WP, sólo necesitamos el media.
                    setAttached((arr) => [
                      ...arr,
                      {
                        id: newId(),
                        // `file` queda undefined — item de Library.
                        localUrl: item.url,
                        media: item,
                        status: 'uploaded',
                      },
                    ]);
                    setLibraryOpen(false);
                  }}
                />
              </div>
            )}
          </div>

          {/* Textarea — fondo transparente, sin borde; los estilos viven en el contenedor padre. */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              attached.length > 0
                ? 'Describe qué quieres hacer con estos archivos...'
                : 'Pregunta, pide un cambio, o arrastra archivos aquí...'
            }
            rows={1}
            style={{ height: TEXTAREA_MIN_HEIGHT_PX }}
            className={clsx(
              'flex-1 bg-transparent text-sm leading-relaxed resize-none',
              'text-text placeholder:text-text-faint py-2.5',
              'border-0 outline-none focus:outline-none focus:ring-0',
              'transition-[height] duration-150 ease-out'
            )}
          />

          {/* Send (cuadrado semiredondeado, primary) — dimensiones fijas w-10 h-10,
              esquinas redondeadas con rounded-card (13px) en las 4 esquinas para
              que se vea como un botón completo, no como un cuadrado recortado. */}
          <button
            type="button"
            onClick={send}
            disabled={
              loading ||
              (!input.trim() && readyCount === 0) ||
              uploadingCount > 0
            }
            aria-label="Enviar"
            title={uploadingCount > 0 ? 'Espera a que terminen los uploads' : 'Enviar'}
            className={clsx(
              'flex-shrink-0 inline-flex items-center justify-center w-10 h-10',
              'bg-accent text-white hover:bg-accent/90 active:bg-accent/80',
              'rounded-card',
              'transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent'
            )}
          >
            {uploadingCount > 0 ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-exports de UI primitivos para consumidores que los quieran inline.
export { Pill, Button };

/**
 * Wrapper legacy: mantiene compatibilidad con código que todavía usa `<Chat />`
 * con la API anterior (`initialConversationId` + URL/localStorage gestionados
 * internamente). El componente real desde la introducción de tabs es
 * `<ChatSession>`. Este wrapper traduce la API vieja a la nueva para que las
 * páginas que aún no migraron (no debería haber ninguna, pero defensivo)
 * sigan funcionando mientras se actualizan.
 *
 * NOTA: este wrapper NO maneja localStorage — el `Chat` legacy sí lo hacía,
 * pero ese comportamiento se delega al padre cuando se usa el sistema de tabs.
 * Si lo necesitás sin tabs, llamá directamente a `<ChatSession>` con la prop
 * `conversationId`.
 */
export function Chat(props: {
  siteId: string;
  site: Site;
  onPendingChanges: (changes: Change[]) => void;
  initialConversationId?: string;
  onToggleSidebar?: () => void;
  modelName?: string;
  onConversationChange?: (convId: string | undefined) => void;
  onActiveChange?: (
    change: Change | null,
    results: Array<{ tool: string; status: string; retries: number; error?: { message: string } }>
  ) => void;
}) {
  // tabId estable por mount del wrapper. `useState` lazy init garantiza que
  // no se regenera entre renders (que sería fatal para la identidad de la
  // sesión en el padre si alguna vez la enchufáramos a tabs).
  const [tabId] = useState(() => newTabId());
  return (
    <ChatSession
      {...props}
      tabId={tabId}
      conversationId={props.initialConversationId}
      // En el wrapper legacy, "Nueva" no tiene tabs a las que pedir que
      // abran una nueva, así que el callback queda undefined y la sesión
      // cae en su comportamiento interno (no-op).
      onNewTab={undefined}
      onTitleChange={undefined}
      // Re-adapta la firma del callback viejo.
      onConversationChange={
        props.onConversationChange
          ? (_tid, convId) => props.onConversationChange?.(convId)
          : undefined
      }
    />
  );
}
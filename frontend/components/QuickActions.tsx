'use client';

import { useEffect, useRef, useState } from 'react';
import {
  // Chip icons (6 acciones principales)
  FileText,
  LayoutTemplate,
  Image as ImageIcon,
  Palette,
  History,
  Wrench,
  // Disclosure affordance
  ChevronDown,
  X,
  // Sub-option icons
  List,
  CheckCircle,
  FileEdit,
  Clock,
  LayoutGrid,
  Search,
  Film,
  Settings,
  ScrollText,
  XCircle,
  Activity,
  RefreshCw,
  Hash,
  // Custom action management
  Plus,
  Trash2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { Card } from './ui/Card';
import {
  loadCustomActions,
  addCustomAction,
  removeCustomAction,
  type CustomQuickAction,
} from '@/lib/customQuickActions';

export interface QuickActionOption {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Prompt predefinido que se inyecta en el textarea cuando el usuario elige esta opción. */
  prompt: string;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  options: QuickActionOption[];
}

/**
 * 6 acciones principales, cada una con 3-4 sub-opciones específicas que
 * escriben un prompt concreto en el textarea del chat. El disclosure se
 * controla por `openId` (single-source-of-truth): solo un sub-panel abierto
 * a la vez. Click fuera / Escape → cierra.
 */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'pages',
    label: 'Páginas',
    icon: FileText,
    options: [
      {
        id: 'all',
        label: 'Todas las páginas',
        description: 'Lista todas las páginas con id, título, estado y URL.',
        icon: List,
        prompt: 'Lista todas las páginas del sitio con id, título, estado y URL.',
      },
      {
        id: 'published',
        label: 'Solo publicadas',
        description: 'Solo páginas con status=publish.',
        icon: CheckCircle,
        prompt: 'Lista solo las páginas publicadas (status=publish) del sitio.',
      },
      {
        id: 'drafts',
        label: 'Solo drafts',
        description: 'Solo páginas en estado borrador (status=draft).',
        icon: FileEdit,
        prompt: 'Lista solo las páginas en estado borrador (status=draft) del sitio.',
      },
      {
        id: 'recent',
        label: 'Recientes (modificadas)',
        description: 'Últimas 10 ordenadas por fecha de modificación.',
        icon: Clock,
        prompt: 'Lista las 10 páginas ordenadas por fecha de modificación más reciente.',
      },
    ],
  },
  {
    id: 'templates',
    label: 'Plantillas',
    icon: LayoutTemplate,
    options: [
      {
        id: 'all',
        label: 'Todas las plantillas',
        description: 'Lista todas con id, título y tipo.',
        icon: List,
        prompt: 'Lista todas las plantillas de Elementor disponibles con id, título y tipo.',
      },
      {
        id: 'page',
        label: 'Solo tipo page',
        description: 'Solo plantillas de tipo page.',
        icon: FileText,
        prompt: 'Lista las plantillas de tipo "page".',
      },
      {
        id: 'section',
        label: 'Solo tipo section',
        description: 'Solo plantillas de tipo section.',
        icon: LayoutGrid,
        prompt: 'Lista las plantillas de tipo "section".',
      },
      {
        id: 'search',
        label: 'Buscar por nombre',
        description: 'Te pediré el nombre exacto y usaré list_templates?search=…',
        icon: Search,
        prompt: 'Pídeme el nombre exacto y la buscaré con `list_templates?search=<name>`.',
      },
    ],
  },
  {
    id: 'media',
    label: 'Media',
    icon: ImageIcon,
    options: [
      {
        id: 'recent',
        label: 'Últimos 10 archivos',
        description: 'Los 10 más recientes con id, título y URL.',
        icon: List,
        prompt: 'Muestra los 10 archivos multimedia más recientes del sitio con id, título y URL.',
      },
      {
        id: 'images',
        label: 'Solo imágenes',
        description: 'Solo archivos de tipo image/*.',
        icon: ImageIcon,
        prompt: 'Lista solo los archivos multimedia de tipo imagen (image/*).',
      },
      {
        id: 'videos',
        label: 'Solo videos',
        description: 'Solo archivos de tipo video/*.',
        icon: Film,
        prompt: 'Lista solo los archivos multimedia de tipo video (video/*).',
      },
      {
        id: 'search',
        label: 'Buscar por nombre',
        description: 'Te pediré el nombre y usaré search_media.',
        icon: Search,
        prompt: 'Pídeme el nombre del archivo y la buscaré con `search_media`.',
      },
    ],
  },
  {
    id: 'design',
    label: 'Design',
    icon: Palette,
    options: [
      {
        id: 'site_settings',
        label: 'Site settings',
        description: 'Versión WP, Elementor y design system.',
        icon: Settings,
        prompt: 'Muestra los ajustes actuales del sitio (versión WP, Elementor, design system).',
      },
      {
        id: 'design_system',
        label: 'Design system',
        description: 'Variables de color, fuentes y espaciado.',
        icon: Palette,
        prompt: 'Lista las variables del design system disponibles (colores, fuentes, espaciado).',
      },
      {
        id: 'audit',
        label: 'Audit log reciente',
        description: 'Últimas 10 ops con acción, página, status y timestamp.',
        icon: ScrollText,
        prompt: 'Muestra las últimas 10 operaciones del audit log con su acción, página, status y timestamp.',
      },
    ],
  },
  {
    id: 'pending',
    label: 'Pendientes',
    icon: History,
    options: [
      {
        id: 'awaiting',
        label: 'Cambios en aprobación',
        description: 'Status=awaiting_approval.',
        icon: Clock,
        prompt: 'Lista los cambios en estado awaiting_approval con su id, título y descripción.',
      },
      {
        id: 'completed',
        label: 'Cambios completados (últimos 10)',
        description: 'Status=completed.',
        icon: CheckCircle,
        prompt: 'Muestra los últimos 10 cambios con status=completed.',
      },
      {
        id: 'failed',
        label: 'Cambios fallidos (últimos 10)',
        description: 'Status=failed.',
        icon: XCircle,
        prompt: 'Muestra los últimos 10 cambios con status=failed.',
      },
    ],
  },
  {
    id: 'debug',
    label: 'Debug',
    icon: Wrench,
    options: [
      {
        id: 'health',
        label: 'Health del sitio',
        description: 'Llama a /health y muestra el estado del plugin, WP y Elementor.',
        icon: Activity,
        prompt: 'Llama a /health y muestra el estado actual del plugin, WP y Elementor.',
      },
      {
        id: 'refresh',
        label: 'Inventario forzar refresh',
        description: 'Invalida cache y refetch toda la metadata.',
        icon: RefreshCw,
        prompt: 'Invalida el cache de inventario y refetch toda la metadata del sitio.',
      },
      {
        id: 'plan_ids',
        label: 'Ver plan templates + IDs',
        description: 'Lista templates con sus IDs exactos para referenciarlos.',
        icon: Hash,
        prompt: 'Lista templates con sus IDs exactos para que pueda referenciarlos con precisión.',
      },
    ],
  },
];

/**
 * Grid de "accesos directos" disclosure-style. Cada chip es un Disclosure
 * que al click expande un sub-panel con opciones específicas (3-4 cada uno).
 * Al elegir una opción, su prompt se escribe en el textarea via onPickPrompt
 * (igual que el comportamiento previo).
 *
 * Layout:
 * - Mobile (< sm, 640px): 2 columnas.
 * - sm+ (640px+): 3 columnas (caben 2 filas).
 * - lg+ (1024px+): 6 columnas (caben todas en una fila).
 *
 * Sub-panel:
 * - Una sola instancia, anchored absolute al wrapper relativo del grid.
 * - Full-width del grid (`left-0 right-0`) debajo del row de chips.
 * - Solo un sub-panel abierto a la vez (controlado por `openId`).
 * - Click fuera / Escape → cierra. Click en opción → escribe prompt y cierra.
 *
 * Visibilidad:
 * - input vacío → opacity 100%.
 * - input con contenido → opacity 40% (fade, hover 70%).
 * - sub-panel abierto → opacity 100% independiente del input.
 */
export function QuickActions({
  inputEmpty,
  onPickPrompt,
}: {
  inputEmpty: boolean;
  onPickPrompt: (prompt: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Custom quick actions del usuario (persisten en localStorage).
  const [customActions, setCustomActions] = useState<CustomQuickAction[]>([]);
  // State del form inline para crear un nuevo custom action.
  // `addingTo` = id de la categoría donde se está agregando (o null si cerrado).
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const currentAction = openId
    ? QUICK_ACTIONS.find((a) => a.id === openId) ?? null
    : null;

  // ─── Custom quick actions ─────────────────────────────────────────────
  // Cargamos customs al montar. NO recargamos en cada open/close: la lista
  // la mantenemos en state local y la sincronizamos con localStorage en
  // cada add/remove. Así evitamos un re-render con flash vacío si el user
  // abre/cierra rápido varios paneles.
  useEffect(() => {
    setCustomActions(loadCustomActions());
  }, []);

  // Cuando se cierra el panel, también cerramos el form de "agregar" para
  // que no quede un form colgado en state al abrir otra categoría.
  useEffect(() => {
    if (openId === null && addingTo !== null) {
      setAddingTo(null);
      setNewLabel('');
      setNewDescription('');
      setNewPrompt('');
    }
  }, [openId, addingTo]);

  /**
   * Merge de built-in options + customs de una categoría, en el orden:
   * built-in primero, customs al final. Cada item tiene un flag `isCustom`
   * para que el render pueda diferenciarlos (badge + botón delete).
   */
  function mergedOptions(categoryId: string) {
    const base = QUICK_ACTIONS.find((a) => a.id === categoryId);
    if (!base) return [];
    const builtIns = base.options.map((o) => ({
      ...o,
      isCustom: false as const,
    }));
    const customs = customActions
      .filter((c) => c.categoryId === categoryId)
      .map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        icon: Sparkles,
        prompt: c.prompt,
        isCustom: true as const,
      }));
    return [...builtIns, ...customs];
  }

  function handleAddCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!addingTo || !newLabel.trim() || !newPrompt.trim()) return;
    const created = addCustomAction({
      categoryId: addingTo,
      label: newLabel.trim(),
      description: newDescription.trim() || 'Acción personalizada',
      prompt: newPrompt.trim(),
    });
    setCustomActions((prev) => [...prev, created]);
    // Reset form.
    setAddingTo(null);
    setNewLabel('');
    setNewDescription('');
    setNewPrompt('');
  }

  function handleDeleteCustom(id: string) {
    removeCustomAction(id);
    setCustomActions((prev) => prev.filter((a) => a.id !== id));
  }

  function cancelAddForm() {
    setAddingTo(null);
    setNewLabel('');
    setNewDescription('');
    setNewPrompt('');
  }

  // ─────────────────────────────────────────────────────────────────────

  // Atenuar cuando hay contenido en el input, EXCEPTO cuando hay un sub-panel
  // abierto (así el usuario puede leer las opciones sin que se atenúen).
  const dimmed = !inputEmpty && openId === null;

  // Cerrar con click fuera / Escape. Solo activamos los listeners cuando hay
  // un panel abierto para no añadir overhead global en reposo.
  useEffect(() => {
    if (!openId) return;

    const onPointerDown = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpenId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenId(null);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

  return (
    <div
      ref={wrapperRef}
      className={clsx(
        'relative mt-2 transition-opacity duration-150 ease-out',
        dimmed ? 'opacity-40 hover:opacity-70' : 'opacity-100'
      )}
      aria-label="Accesos directos del chat"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          const isOpen = openId === action.id;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => setOpenId(isOpen ? null : action.id)}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              aria-controls={
                isOpen ? `quick-actions-panel-${action.id}` : undefined
              }
              title={`Opciones de ${action.label}`}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2.5 rounded-card text-sm font-medium min-w-0',
                'border border-panel-border transition-all duration-150 ease-out',
                isOpen
                  ? 'bg-accent-soft border-accent text-accent'
                  : 'bg-zinc-200/30 text-text-muted hover:text-accent hover:border-accent hover:bg-accent-soft'
              )}
            >
              <Icon size={14} className="flex-shrink-0" />
              <span className="truncate flex-1 text-left">{action.label}</span>
              <ChevronDown
                size={12}
                className={clsx(
                  'flex-shrink-0 opacity-60 transition-transform duration-150',
                  isOpen && 'rotate-180'
                )}
              />
            </button>
          );
        })}
      </div>

      {currentAction && (
        <div
          id={`quick-actions-panel-${currentAction.id}`}
          role="region"
          aria-label={`Opciones de ${currentAction.label}`}
          className="absolute bottom-full left-0 right-0 mb-2 z-20"
        >
          <Card variant="popover" padding="md">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <currentAction.icon size={14} className="text-accent flex-shrink-0" />
                <span className="text-sm font-semibold text-text truncate">
                  {currentAction.label}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                aria-label={`Cerrar opciones de ${currentAction.label}`}
                className="p-1 rounded text-text-muted hover:text-text hover:bg-surface transition flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
            <ul className="space-y-0.5">
              {mergedOptions(currentAction.id).map((opt) => {
                const OptIcon = opt.icon;
                return (
                  <li key={opt.id} className="group/option relative">
                    <button
                      type="button"
                      onClick={() => {
                        onPickPrompt(opt.prompt);
                        setOpenId(null);
                      }}
                      className={clsx(
                        'w-full flex items-start gap-2.5 pl-3 pr-8 py-2 rounded-card text-left',
                        'hover:bg-surface transition-colors duration-150'
                      )}
                    >
                      <OptIcon
                        size={14}
                        className={clsx(
                          'flex-shrink-0 mt-0.5',
                          opt.isCustom ? 'text-accent-muted' : 'text-accent'
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-medium text-text truncate">
                            {opt.label}
                          </span>
                          {opt.isCustom && (
                            <span
                              className="text-[9px] uppercase tracking-wide font-semibold text-accent-muted flex-shrink-0"
                              title="Acción personalizada"
                            >
                              custom
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5 leading-snug">
                          {opt.description}
                        </div>
                      </div>
                    </button>
                    {opt.isCustom && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustom(opt.id);
                        }}
                        aria-label={`Eliminar acceso directo "${opt.label}"`}
                        title="Eliminar este acceso directo"
                        className={clsx(
                          'absolute right-1.5 top-1.5 p-1 rounded',
                          'text-text-faint hover:text-danger hover:bg-danger-soft',
                          'opacity-0 group-hover/option:opacity-100 transition'
                        )}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Footer: agregar nuevo acceso directo o form inline. */}
            {addingTo === currentAction.id ? (
              <form
                onSubmit={handleAddCustom}
                className="mt-3 pt-3 border-t border-panel-border space-y-2"
                aria-label={`Crear acceso directo en ${currentAction.label}`}
              >
                <input
                  type="text"
                  placeholder="Etiqueta (ej: 'Páginas con CTA amarillo')"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  maxLength={60}
                  autoFocus
                  className={clsx(
                    'w-full px-2.5 py-1.5 rounded-card text-sm',
                    'bg-surface border border-panel-border text-text',
                    'placeholder:text-text-faint',
                    'focus:outline-none focus:border-accent/60'
                  )}
                />
                <input
                  type="text"
                  placeholder="Descripción corta (opcional)"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  maxLength={120}
                  className={clsx(
                    'w-full px-2.5 py-1.5 rounded-card text-sm',
                    'bg-surface border border-panel-border text-text',
                    'placeholder:text-text-faint',
                    'focus:outline-none focus:border-accent/60'
                  )}
                />
                <textarea
                  placeholder="Prompt (lo que se inyecta en el chat al elegirlo)"
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className={clsx(
                    'w-full px-2.5 py-1.5 rounded-card text-sm resize-none',
                    'bg-surface border border-panel-border text-text',
                    'placeholder:text-text-faint',
                    'focus:outline-none focus:border-accent/60'
                  )}
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={cancelAddForm}
                    className="px-3 py-1.5 text-xs rounded-card text-text-muted hover:text-text hover:bg-surface transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!newLabel.trim() || !newPrompt.trim()}
                    className={clsx(
                      'px-3 py-1.5 text-xs rounded-card font-medium transition',
                      'bg-accent text-white hover:bg-accent/90',
                      'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent'
                    )}
                  >
                    Guardar
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAddingTo(currentAction.id)}
                className={clsx(
                  'mt-3 pt-3 border-t border-panel-border w-full',
                  'flex items-center justify-center gap-1.5 px-3 py-2',
                  'text-xs text-text-muted hover:text-accent hover:bg-surface rounded-card transition'
                )}
                aria-label={`Agregar acceso directo a ${currentAction.label}`}
              >
                <Plus size={12} />
                Agregar acceso directo
              </button>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  RefreshCw,
  Copy,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  Check,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { Avatar } from './ui/Avatar';

/**
 * MessageBubble — bloque visual de un mensaje del chat.
 *
 * Renderiza avatar + bubble con:
 *   - role 'user'      → avatar `accent/15` con inicial; bubble `bg-accent text-white`.
 *   - role 'assistant' → avatar gradiente morado→azul con Sparkles;
 *                         bubble `bg-panel border border-panel-border`;
 *                         toolbar (regenerate/copy/like/dislike/menu) `opacity-0
 *                         group-hover:opacity-100` debajo del bubble.
 *
 * Estado interno (efímero, por burbuja):
 *   - `copied`   → feedback visual de "Copiado!" (vuelve a false tras 1.5s).
 *   - `liked`    → toggle del thumbs-up; al activarlo limpia `disliked`.
 *   - `disliked` → toggle del thumbs-down; al activarlo limpia `liked`.
 *
 * El padre puede pasar `actions` custom (típicamente un `<ChangePlanView>`)
 * y un callback `onRegenerate` para que el botón de regenerar dispare la
 * re-ejecución del mensaje del usuario en el backend.
 */
export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Acciones / extras debajo del texto (ej. ChangePlanView). */
  actions?: ReactNode;
  /** Si true, fuerza mostrar toolbar (útil para tests). */
  alwaysShowToolbar?: boolean;
  /** Callback al hacer click en regenerate (solo assistant). Si falta, el botón queda disabled. */
  onRegenerate?: () => void;
  /** Iniciales del usuario (para avatar). Default: 'TÚ'. */
  userInitials?: string;
  /** Si es el primer mensaje del assistant, mostrar el nombre "AI Website Agent" arriba del bubble. */
  showAssistantName?: boolean;
  /** Label opcional del assistant (default 'AI Website Agent'). */
  assistantName?: string;
}

export function MessageBubble({
  role,
  text,
  actions,
  alwaysShowToolbar = false,
  onRegenerate,
  userInitials = 'TÚ',
  showAssistantName = false,
  assistantName = 'AI Website Agent',
}: MessageBubbleProps) {
  const isUser = role === 'user';

  // Estado efímero de feedback por burbuja.
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  const handleCopy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Sin feedback de error en UI: el failure es silencioso.
      });
  };

  const handleLike = () => {
    setLiked((prev) => {
      const next = !prev;
      // Like y dislike son mutuamente excluyentes.
      if (next) setDisliked(false);
      return next;
    });
  };

  const handleDislike = () => {
    setDisliked((prev) => {
      const next = !prev;
      if (next) setLiked(false);
      return next;
    });
  };

  return (
    <div
      className={clsx(
        'group flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      {isUser ? (
        <Avatar variant="user" size="md" initials={userInitials} />
      ) : (
        <Avatar variant="assistant" size="md" ariaLabel={assistantName}>
          <Sparkles size={16} />
        </Avatar>
      )}

      {/* Bubble + toolbar */}
      <div
        className={clsx(
          'flex flex-col min-w-0 max-w-2xl',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {!isUser && showAssistantName && (
          <div className="text-xs font-medium text-text mb-1 px-1">
            {assistantName}
          </div>
        )}

        <div className="relative">
          <div
            className={clsx(
              'rounded-bubble px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words',
              isUser
                ? 'bg-accent text-white'
                : 'bg-panel border border-panel-border text-text'
            )}
          >
            {text}
          </div>
        </div>

        {/* Acciones custom (ChangePlanView, etc) — debajo del bubble, dentro del group. */}
        {actions && <div className="mt-3 w-full">{actions}</div>}

        {/* Toolbar de acciones (solo assistant, debajo del bubble) */}
        {!isUser && (
          <BubbleToolbar
            visible={alwaysShowToolbar}
            copied={copied}
            liked={liked}
            disliked={disliked}
            onCopy={handleCopy}
            onLike={handleLike}
            onDislike={handleDislike}
            onRegenerate={onRegenerate}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Toolbar debajo del bubble del assistant (regenerate/copy/like/dislike/menu).
 * Aparece solo al hover del bubble padre (`opacity-0 group-hover:opacity-100`).
 *
 * Estado:
 *   - `copied`   → muestra Check verde en vez de Copy durante 1.5s.
 *   - `liked`    → ThumbsUp con `fill-current` + color success.
 *   - `disliked` → ThumbsDown con `fill-current` + color danger.
 */
function BubbleToolbar({
  visible,
  copied,
  liked,
  disliked,
  onCopy,
  onLike,
  onDislike,
  onRegenerate,
}: {
  visible?: boolean;
  copied: boolean;
  liked: boolean;
  disliked: boolean;
  onCopy: () => void;
  onLike: () => void;
  onDislike: () => void;
  onRegenerate?: () => void;
}) {
  return (
    <div
      className={clsx(
        'mt-2 flex items-center gap-1 transition',
        visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      )}
      role="toolbar"
      aria-label="Acciones del mensaje"
    >
      <ToolbarButton
        title="Regenerar respuesta"
        onClick={onRegenerate}
        disabled={!onRegenerate}
      >
        <RefreshCw size={12} />
      </ToolbarButton>
      <ToolbarButton
        title={copied ? '¡Copiado!' : 'Copiar mensaje'}
        onClick={onCopy}
      >
        {copied ? (
          <Check size={12} className="text-success" />
        ) : (
          <Copy size={12} />
        )}
      </ToolbarButton>
      <ToolbarButton title="Me gusta" onClick={onLike}>
        <ThumbsUp
          size={12}
          className={clsx(liked && 'fill-current text-success')}
        />
      </ToolbarButton>
      <ToolbarButton title="No me gusta" onClick={onDislike}>
        <ThumbsDown
          size={12}
          className={clsx(disliked && 'fill-current text-danger')}
        />
      </ToolbarButton>
      <ToolbarButton title="Más acciones">
        <MoreHorizontal size={12} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const isDisabled = disabled || !onClick;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={isDisabled}
      className={clsx(
        'inline-flex items-center justify-center h-7 w-7 rounded-full',
        'text-text-muted hover:text-text hover:bg-surface transition',
        isDisabled && 'opacity-50 cursor-not-allowed hover:bg-transparent'
      )}
    >
      {children}
    </button>
  );
}

// Re-export del icono Check por conveniencia.
export { Check };
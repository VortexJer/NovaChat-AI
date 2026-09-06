/**
 * Iconos y marca.
 *
 * SVG en linea, no una libreria: son quince trazos y meter un paquete de
 * iconos anadiria peso de descarga y una dependencia mas que mantener. Todos
 * heredan currentColor y el tamano por prop.
 */

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/**
 * La marca nova: un roundel hexagonal solido con un doble chevron negativo.
 *
 * Sin degradado: un unico rojo solido, el mismo acento que el resto de la
 * interfaz. El hexagono evoca un roundel de motorsport (el disco numerado de
 * un coche de carreras); el doble chevron es una marca de velocidad, no una
 * letra que deje de leerse a tamano de favicon. Es exactamente lo contrario
 * del sparkle en degradado violeta que llevaba antes: nada de curvas
 * concavas, nada de brillo, un solo color solido y formas rectas.
 */
export function NovaMark({ size = 28, id }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden id={id}>
      <polygon points="44,24 34,6.7 14,6.7 4,24 14,41.3 34,41.3" fill="#e10600" />
      <polygon points="13,13 24,24 13,35" fill="#0b0c0e" />
      <polygon points="24,13 35,24 24,35" fill="#0b0c0e" />
    </svg>
  );
}

export const Plus = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Send = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const Stop = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const Copy = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

export const Check = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);

export const Refresh = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </svg>
);

export const Trash = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
);

export const Pencil = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
  </svg>
);

export const Pin = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 14v7" />
  </svg>
);

export const Dots = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const Chevron = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ChevronLeft = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const ChevronRight = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const Menu = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const Settings = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.6V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 2.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7c.3.6.9 1 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const Keyboard = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 13h8" />
  </svg>
);

export const Logout = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2M11 12h10M18 9l3 3-3 3" />
  </svg>
);

export const FileIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v4h4M9 13h6M9 17h6" />
  </svg>
);

export const Mic = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3M8.5 22h7" />
  </svg>
);

export const Paperclip = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M21 11.5 12.5 20a4.5 4.5 0 0 1-6.4-6.4L14.6 5a3 3 0 0 1 4.3 4.3l-8.5 8.5a1.5 1.5 0 0 1-2.1-2.1l7.8-7.8" />
  </svg>
);

export const Globe = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
  </svg>
);

export const Spark = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3c.6 4.7 2 7.5 4.2 8.8C18.4 12.9 20.5 13 22 12c-1.5 1-3.6 1.1-5.8 2.2C14 15.5 12.6 18.3 12 23c-.6-4.7-2-7.5-4.2-8.8C5.6 13.1 3.5 13 2 12c1.5-1 3.6-1.1 5.8-2.2C10 8.5 11.4 5.7 12 3Z" />
  </svg>
);

export const Speaker = ({ size = 13 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" />
  </svg>
);

export const SpeakerOff = ({ size = 13 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M17 10l4 4M21 10l-4 4" />
  </svg>
);

/* Iconos de la navegacion principal, con la misma reja de 24 y el mismo
   trazo que los demas: heredan currentColor y el tamano por prop. */
export const Folder = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7h6l2 2h10v10H3z" />
    <path d="M3 7V5h6l2 2" />
  </svg>
);

export const Grid = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

export const Clock = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const Briefcase = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="7" width="18" height="13" />
    <path d="M9 7V5h6v2" />
  </svg>
);

/** Enchufe: los conectores. */
export const Plug = ({ size = 15 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 2v6" />
    <path d="M15 2v6" />
    <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
    <path d="M12 17v5" />
  </svg>
);

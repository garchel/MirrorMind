import {
  Building2,
  Cake,
  Calendar,
  CheckSquare,
  CircleDot,
  Flag,
  Globe,
  Hash,
  Link,
  Mail,
  MapPin,
  Phone,
  Tag,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react'

/** Propriedade comum do frontmatter: chave crua + rotulo amigavel + icone. */
export type CommonProperty = { key: string; label: string; icon: LucideIcon }

/**
 * Propriedades comuns oferecidas no menu de propriedades do header (modo
 * Misto, popover do "+" no arrow down) e no seletor de colunas da pagina
 * Tabela — a MESMA lista nos dois lugares (ex.: o icone de telefone adiciona
 * a propriedade `phone`).
 */
export const COMMON_PROPERTIES: CommonProperty[] = [
  { key: 'phone', label: 'Telefone', icon: Phone },
  { key: 'email', label: 'E-mail', icon: Mail },
  { key: 'url', label: 'URL', icon: Link },
  { key: 'website', label: 'Site', icon: Globe },
  { key: 'date', label: 'Data', icon: Calendar },
  { key: 'author', label: 'Autor', icon: User },
  { key: 'location', label: 'Local', icon: MapPin },
  { key: 'company', label: 'Empresa', icon: Building2 },
  { key: 'birthday', label: 'Aniversário', icon: Cake },
  { key: 'tags', label: 'Tags', icon: Tag },
  { key: 'priority', label: 'Prioridade', icon: Flag },
  { key: 'status', label: 'Status', icon: CircleDot },
  { key: 'number', label: 'Número', icon: Hash },
  { key: 'text', label: 'Texto', icon: Type },
  { key: 'checkbox', label: 'Checkbox', icon: CheckSquare },
]

/** Chaves das propriedades comuns, na ordem canonica. */
export const COMMON_PROPERTY_KEYS: readonly string[] = COMMON_PROPERTIES.map((property) => property.key)

const PROPERTY_ICON_BY_KEY: Readonly<Record<string, LucideIcon>> = Object.fromEntries(
  COMMON_PROPERTIES.map((property) => [property.key, property.icon]),
)

/** Icone de uma propriedade: o das comuns por chave (case-insensitive), ou um
 * generico para chaves customizadas. */
export function propertyIcon(key: string): LucideIcon {
  return PROPERTY_ICON_BY_KEY[key.trim().toLowerCase()] ?? Hash
}


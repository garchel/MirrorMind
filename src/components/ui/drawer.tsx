import type { ComponentProps } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import './ui.css'

/**
 * Drawer no padrao do shadcn/ui, construido sobre vaul e adaptado ao CSS
 * plain do projeto (sem Tailwind). API identica: Root, Trigger, Portal,
 * Overlay, Content, Handle, Header, Footer, Title, Description e Close.
 */
const Drawer = DrawerPrimitive.Root
const DrawerTrigger = DrawerPrimitive.Trigger
const DrawerPortal = DrawerPrimitive.Portal
const DrawerClose = DrawerPrimitive.Close

function DrawerOverlay({ className = '', ...props }: ComponentProps<typeof DrawerPrimitive.Overlay> & { className?: string }) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={['ui-drawer-overlay', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}

function DrawerContent({
  className = '',
  children,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content> & { className?: string }) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={['ui-drawer-content', className].filter(Boolean).join(' ')}
        {...props}
      >
        <DrawerPrimitive.Handle className="ui-drawer-handle" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className = '', ...props }: ComponentProps<'div'> & { className?: string }) {
  return <div data-slot="drawer-header" className={['ui-drawer-header', className].filter(Boolean).join(' ')} {...props} />
}

function DrawerFooter({ className = '', ...props }: ComponentProps<'div'> & { className?: string }) {
  return <div data-slot="drawer-footer" className={['ui-drawer-footer', className].filter(Boolean).join(' ')} {...props} />
}

function DrawerTitle({ className = '', ...props }: ComponentProps<typeof DrawerPrimitive.Title> & { className?: string }) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={['ui-drawer-title', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}

function DrawerDescription({
  className = '',
  ...props
}: ComponentProps<typeof DrawerPrimitive.Description> & { className?: string }) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={['ui-drawer-description', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
}

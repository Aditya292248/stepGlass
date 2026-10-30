// A side panel built on Radix Dialog, in the shadcn/ui style: Radix supplies focus trapping,
// Escape to close and scroll locking; this file only adds the styling.
import * as Dialog from '@radix-ui/react-dialog'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export const Sheet = Dialog.Root
export const SheetTrigger = Dialog.Trigger
export const SheetClose = Dialog.Close

export function SheetContent({
	className,
	children,
	...props
}: ComponentProps<typeof Dialog.Content>) {
	return (
		<Dialog.Portal>
			<Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
			<Dialog.Content
				className={cn(
					'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-surface shadow-xl',
					className,
				)}
				{...props}
			>
				{children}
			</Dialog.Content>
		</Dialog.Portal>
	)
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof Dialog.Title>) {
	return <Dialog.Title className={cn('sr-only', className)} {...props} />
}

export function SheetDescription({
	className,
	...props
}: ComponentProps<typeof Dialog.Description>) {
	return <Dialog.Description className={cn('sr-only', className)} {...props} />
}

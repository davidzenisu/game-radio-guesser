import React from 'react'

// Default button component: ensure non-form buttons do not submit by default
export function Button({ children, className = '', variant = 'primary', type = 'button', ...props }){
  const base = 'inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium'
  const style = variant === 'primary' ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-transparent text-slate-700'
  return <button type={type} className={`${base} ${style} ${className}`} {...props}>{children}</button>
}

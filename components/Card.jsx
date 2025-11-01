import React from 'react'

export function Card({ children, className = '' }){
  return <div className={`bg-white p-4 rounded-lg shadow-sm ${className}`}>{children}</div>
}

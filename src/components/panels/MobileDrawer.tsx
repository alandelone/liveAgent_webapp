import React from 'react';
import { X } from 'lucide-react';

export interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <div className="relative w-full max-h-[85vh] h-[70vh] bg-surface border-t border-slate-700 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up z-10">
        {/* Drag Handle & Header */}
        <div className="flex flex-col items-center pt-3 pb-2 px-4 border-b border-slate-800 shrink-0">
          <div className="w-12 h-1.5 rounded-full bg-slate-700 mb-2" />
          <div className="flex items-center justify-between w-full">
            <span className="text-sm font-bold text-white">{title}</span>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-full text-slate-400 hover:text-white bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
};

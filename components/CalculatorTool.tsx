import React, { useState, useEffect } from 'react';
import { X, DollarSign, Calculator, RefreshCw, Delete } from 'lucide-react';

interface CalculatorToolProps {
  onClose: () => void;
}

export const CalculatorTool: React.FC<CalculatorToolProps> = ({ onClose }) => {
  const [mode, setMode] = useState<'profit' | 'standard'>('profit');

  // --- PROFIT MODE STATE ---
  const [salePrice, setSalePrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [extraCost, setExtraCost] = useState(''); // Ship + Repair
  const [feePercent, setFeePercent] = useState('13'); // Default eBay approx

  // --- STANDARD MODE STATE ---
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  // Profit Calculations
  const s = parseFloat(salePrice) || 0;
  const c = parseFloat(costPrice) || 0;
  const e = parseFloat(extraCost) || 0;
  const f = parseFloat(feePercent) || 0;

  const feeAmount = s * (f / 100);
  const totalCost = c + e + feeAmount;
  const netProfit = s - totalCost;
  const margin = s > 0 ? (netProfit / s) * 100 : 0;
  const roi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

  // Standard Calculator Logic
  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplay(String(digit));
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? String(digit) : display + digit);
    }
  };

  const performOperation = (nextOperator: string) => {
    const inputValue = parseFloat(display);

    if (prevValue === null) {
      setPrevValue(inputValue);
    } else if (operator) {
      const currentValue = prevValue || 0;
      const newValue = calculate(currentValue, inputValue, operator);
      setPrevValue(newValue);
      setDisplay(String(newValue));
    }

    setWaitingForOperand(true);
    setOperator(nextOperator);
  };

  const calculate = (left: number, right: number, op: string) => {
    switch (op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return left / right;
      default: return right;
    }
  };

  const handleClear = () => {
    setDisplay('0');
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  };

  // Keyboard Support for Numpad
  useEffect(() => {
    if (mode !== 'standard') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const { key } = event;

      // Numbers
      if (/^[0-9]$/.test(key)) {
        event.preventDefault();
        inputDigit(key);
      }
      // Operators
      else if (['+', '-', '*', '/'].includes(key)) {
        event.preventDefault();
        performOperation(key);
      }
      // Decimal
      else if (key === '.') {
        event.preventDefault();
        inputDigit('.');
      }
      // Enter / Equals
      else if (key === 'Enter' || key === '=') {
        event.preventDefault();
        performOperation('=');
      }
      // Clear (Escape or C)
      else if (key === 'Escape' || key.toLowerCase() === 'c') {
        event.preventDefault();
        handleClear();
      }
      // Backspace
      else if (key === 'Backspace') {
        event.preventDefault();
        if (!waitingForOperand) {
           setDisplay(prev => {
             if (prev.length <= 1) return '0';
             return prev.slice(0, -1);
           });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, display, prevValue, operator, waitingForOperand]);

  return (
    <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-50 animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 w-80 md:w-96 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-50 dark:bg-slate-800 p-3 flex justify-between items-center border-b border-slate-100 dark:border-slate-700 cursor-move">
          <div className="flex gap-2 p-1 bg-slate-200 dark:bg-slate-700 rounded-lg">
             <button 
               onClick={() => setMode('profit')}
               className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mode === 'profit' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}
             >
               Flipper
             </button>
             <button 
               onClick={() => setMode('standard')}
               className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${mode === 'standard' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}
             >
               Math
             </button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {mode === 'profit' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Sale Price</label>
                  <div className="relative mt-1">
                    <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input 
                      type="number" 
                      value={salePrice}
                      onChange={e => setSalePrice(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-slate-800 dark:text-white"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Item Cost</label>
                  <div className="relative mt-1">
                    <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input 
                      type="number" 
                      value={costPrice}
                      onChange={e => setCostPrice(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-slate-800 dark:text-white"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Repair/Ship</label>
                  <div className="relative mt-1">
                    <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input 
                      type="number" 
                      value={extraCost}
                      onChange={e => setExtraCost(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-slate-800 dark:text-white"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Platform Fee %</label>
                  <div className="flex items-center gap-1 mt-1">
                    <input 
                      type="number" 
                      value={feePercent}
                      onChange={e => setFeePercent(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-medium text-slate-800 dark:text-white"
                    />
                    {/* Quick Fee Buttons */}
                  </div>
                </div>
              </div>

              {/* Quick Percentage Toggles */}
              <div className="flex gap-2">
                 {[5, 10, 13, 15].map(p => (
                   <button 
                     key={p}
                     onClick={() => setFeePercent(p.toString())}
                     className={`flex-1 py-1 text-[10px] font-bold rounded border ${parseFloat(feePercent) === p ? 'bg-indigo-100 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300' : 'bg-white border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                   >
                     {p}%
                   </button>
                 ))}
              </div>

              {/* Results */}
              <div className={`mt-4 p-4 rounded-xl border ${netProfit >= 0 ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-900/30' : 'bg-rose-50 border-rose-100 dark:bg-rose-900/10 dark:border-rose-900/30'}`}>
                <div className="flex justify-between items-end mb-2">
                   <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Net Profit</span>
                   <span className={`text-3xl font-bold ${netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                     ${netProfit.toFixed(2)}
                   </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200/50 dark:border-slate-700/50 text-xs">
                   <div className="flex flex-col">
                      <span className="text-slate-400">Margin</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">{margin.toFixed(1)}%</span>
                   </div>
                   <div className="flex flex-col text-right">
                      <span className="text-slate-400">ROI</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">{roi.toFixed(1)}%</span>
                   </div>
                   <div className="flex flex-col text-right">
                      <span className="text-slate-400">Fees Paid</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">${feeAmount.toFixed(2)}</span>
                   </div>
                </div>
              </div>
              
              <button 
                onClick={() => { setSalePrice(''); setCostPrice(''); setExtraCost(''); }}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-400 hover:text-indigo-500 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Reset Fields
              </button>

            </div>
          ) : (
            <div className="space-y-4">
              <div className="w-full h-16 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-end px-4 text-3xl font-mono text-slate-800 dark:text-slate-100 overflow-hidden">
                {display}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <button onClick={handleClear} className="col-span-3 py-3 bg-rose-100 text-rose-600 rounded-lg font-bold hover:bg-rose-200 transition-colors">AC</button>
                <button onClick={() => performOperation('/')} className="py-3 bg-indigo-100 text-indigo-600 rounded-lg font-bold hover:bg-indigo-200 text-lg">÷</button>
                
                <button onClick={() => inputDigit('7')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">7</button>
                <button onClick={() => inputDigit('8')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">8</button>
                <button onClick={() => inputDigit('9')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">9</button>
                <button onClick={() => performOperation('*')} className="py-3 bg-indigo-100 text-indigo-600 rounded-lg font-bold hover:bg-indigo-200 text-lg">×</button>

                <button onClick={() => inputDigit('4')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">4</button>
                <button onClick={() => inputDigit('5')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">5</button>
                <button onClick={() => inputDigit('6')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">6</button>
                <button onClick={() => performOperation('-')} className="py-3 bg-indigo-100 text-indigo-600 rounded-lg font-bold hover:bg-indigo-200 text-lg">-</button>

                <button onClick={() => inputDigit('1')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">1</button>
                <button onClick={() => inputDigit('2')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">2</button>
                <button onClick={() => inputDigit('3')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">3</button>
                <button onClick={() => performOperation('+')} className="py-3 bg-indigo-100 text-indigo-600 rounded-lg font-bold hover:bg-indigo-200 text-lg">+</button>

                <button onClick={() => inputDigit('0')} className="col-span-2 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">0</button>
                <button onClick={() => inputDigit('.')} className="py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-100 dark:hover:bg-slate-700 text-lg">.</button>
                <button onClick={() => performOperation('=')} className="py-3 bg-emerald-500 text-white rounded-lg font-bold hover:bg-emerald-600 shadow-lg shadow-emerald-500/30 text-lg">=</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
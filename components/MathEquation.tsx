import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

interface MathEquationProps {
  equation: string;
  displayMode?: boolean;
}

export function MathEquation({ equation, displayMode = false }: MathEquationProps) {
  return displayMode ? <BlockMath math={equation} /> : <InlineMath math={equation} />;
} 
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
     
    console.error("ErrorBoundary caught", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div role="alert" className="p-8 max-w-xl mx-auto text-center font-mono">
        <h2 className="text-neon-magenta text-lg uppercase tracking-widest mb-2">
          something broke
        </h2>
        <p className="text-ink-dim text-sm mb-4">{error.message}</p>
        <Button onClick={this.reset}>retry</Button>
      </div>
    );
  }
}

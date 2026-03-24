import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400 mb-4" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">
            {this.props.fallbackLabel ?? "Something went wrong"}
          </h2>
          <p className="text-sm text-gray-500 mb-1 max-w-sm">
            {this.state.error?.message ?? "An unexpected error occurred in this section."}
          </p>
          <p className="text-xs text-gray-400 mb-6 max-w-sm">
            Check the browser console for details. If this persists, try reloading the page.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

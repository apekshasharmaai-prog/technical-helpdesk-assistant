import { Component, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Workspace } from "./Workspace";

const queryClient = new QueryClient();

class ErrorBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main role="alert">
      <h1>The workspace could not be displayed.</h1>
      <p>Your saved browser data has not been deleted. Reload the page to retry.</p>
      <button onClick={() => window.location.reload()}>Reload</button>
    </main>;
    return this.props.children;
  }
}

export default function App() {
  return <ErrorBoundary><QueryClientProvider client={queryClient}>
    <Workspace />
  </QueryClientProvider></ErrorBoundary>;
}

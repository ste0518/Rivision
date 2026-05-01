"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  children: ReactNode;
  title?: string;
  description?: string;
  onResetLocalData?: () => void;
};

type State = {
  error?: Error;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle>{this.props.title ?? "Something went wrong"}</CardTitle>
          <CardDescription>{this.props.description ?? "The page caught a runtime error instead of crashing."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs text-red-900">
            {this.state.error.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => this.setState({ error: undefined })}>
              Try again
            </Button>
            {this.props.onResetLocalData ? (
              <Button type="button" variant="destructive" onClick={this.props.onResetLocalData}>
                Reset local data
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }
}

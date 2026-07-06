import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/methods/$methodId")({
  component: MethodDetailLayout,
});

function MethodDetailLayout() {
  return <Outlet />;
}

from django.urls import path

from apps.systems.views import (
    HeartbeatView,
    PlatformSummaryView,
    SystemDetailView,
    SystemMetricsView,
    SystemPortsView,
    SystemsView,
)


urlpatterns = [
    path("systems", SystemsView.as_view()),
    path("platform-summary", PlatformSummaryView.as_view()),
    path("systems/<str:system_id>", SystemDetailView.as_view()),
    path("systems/<str:system_id>/metrics", SystemMetricsView.as_view()),
    path("systems/<str:system_id>/ports", SystemPortsView.as_view()),
    path("heartbeat", HeartbeatView.as_view()),
]
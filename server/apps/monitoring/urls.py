from django.urls import path

from apps.monitoring.views import (
	AuditLogsView,
	LiveMonitoringView,
	SettingsView,
	SystemHealthView,
	SystemHistoryView,
	SystemLiveView,
	SystemNetworkView,
	SystemUpsView,
)


urlpatterns = [
	path("settings", SettingsView.as_view()),
	path("audit-logs", AuditLogsView.as_view()),
	path("live-monitoring", LiveMonitoringView.as_view()),
	path("systems/<str:system_id>/live", SystemLiveView.as_view()),
	path("systems/<str:system_id>/network", SystemNetworkView.as_view()),
	path("systems/<str:system_id>/ups", SystemUpsView.as_view()),
	path("systems/<str:system_id>/health", SystemHealthView.as_view()),
	path("systems/<str:system_id>/history", SystemHistoryView.as_view()),
]
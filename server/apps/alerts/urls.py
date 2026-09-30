from django.urls import path

from apps.alerts.views import AlertDetailView, AlertsView


urlpatterns = [
    path("alerts", AlertsView.as_view()),
    path("alerts/<str:alert_id>", AlertDetailView.as_view()),
]
from django.urls import include, path

from apps.authentication.views import HealthView, LoginView


urlpatterns = [
    path("api/health", HealthView.as_view()),
    path("api/auth/login", LoginView.as_view()),
    path("api/", include("apps.systems.urls")),
    path("api/", include("apps.alerts.urls")),
    path("api/", include("apps.commands.urls")),
    path("api/", include("apps.reports.urls")),
    path("api/", include("apps.monitoring.urls")),
]
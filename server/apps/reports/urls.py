from django.urls import path

from apps.reports.views import BulkReportView, SystemReportView


urlpatterns = [
    path("systems/<str:system_id>/report/pdf", SystemReportView.as_view()),
    path("reports/pdf", BulkReportView.as_view()),
]
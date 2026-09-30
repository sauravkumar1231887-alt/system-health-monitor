from django.urls import path

from apps.commands.views import AgentCommandPollView, AgentCommandResultView, CommandsView, SystemActionView


urlpatterns = [
    path("commands", CommandsView.as_view()),
    path("systems/<str:system_id>/actions/<str:action>", SystemActionView.as_view()),
    path("agent/commands/poll", AgentCommandPollView.as_view()),
    path("agent/commands/<str:command_id>/result", AgentCommandResultView.as_view()),
]
from django.test.runner import DiscoverRunner


class MongoNoSqlTestRunner(DiscoverRunner):
    """Run API tests without creating a relational test database."""

    def setup_databases(self, **kwargs):
        return None

    def teardown_databases(self, old_config, **kwargs):
        return None
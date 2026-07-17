web: cd backend && python manage.py migrate && python manage.py load_initial_data && python manage.py create_seed_users && gunicorn meesho_project.wsgi:application --bind 0.0.0.0:$PORT

from django.core.management.base import BaseCommand

from users.models import User


class Command(BaseCommand):
    help = 'Cria ou promove um usuário para super_admin (acesso total às configurações)'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('senha')

    def handle(self, *args, **options):
        email = options['email']
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            user = User.objects.create_superuser(
                email=email, nome='Super Admin', password=options['senha'],
            )
            self.stdout.write(self.style.SUCCESS(
                f'Super admin criado: {user.email} (id {user.pk})'
            ))
            return
        if user.papel == 'super_admin':
            self.stdout.write(f'{user.email} já é super_admin; nada a fazer.')
            return
        # Usuário existente só é promovido: trocar a senha de quem já tem
        # conta sem avisar deixaria gente trancada para fora.
        user.papel = 'super_admin'
        user.save(update_fields=['papel'])
        self.stdout.write(self.style.SUCCESS(
            f'{user.email} promovido a super_admin (senha mantida).'
        ))

import HomePage from '@/app/page';
import { getSql } from '@/lib/db';

export async function generateMetadata({ params }) {
  try {
    const { username } = await params;
    const rows = await getSql()`SELECT p.display_name, p.username, p.bio, COALESCE(m.public_url, u.image, '') AS avatar
      FROM user_profiles p JOIN auth_users u ON u.id=p.auth_user_id
      LEFT JOIN user_media_uploads m ON m.id=p.avatar_media_id AND m.status='ACTIVE'
      WHERE lower(p.username)=lower(${username}) AND p.status='ACTIVE' LIMIT 1`;
    if (!rows.length) return { title: 'Perfil no encontrado — Dubverse' };
    const profile = rows[0];
    const title = `${profile.display_name} (@${profile.username}) — Dubverse`;
    const description = profile.bio || `Perfil público de ${profile.display_name} en Dubverse.`;
    return { title, description, openGraph: { title, description, type: 'profile', images: profile.avatar ? [{ url: profile.avatar }] : [] } };
  } catch { return { title: 'Perfil — Dubverse' }; }
}

export default HomePage;

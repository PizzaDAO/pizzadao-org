import AnonymousVote from '@/components/AnonymousVote'

type Props = {
  params: Promise<{ pollId: string }>
}

export default async function VotePage({ params }: Props) {
  const { pollId } = await params

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-lg mx-auto px-4">
        <AnonymousVote pollId={pollId} />
      </div>
    </div>
  )
}
